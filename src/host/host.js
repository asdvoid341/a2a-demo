import { buildSystemPrompt, buildTools } from './prompt.js';
import { summarizeTask } from '../a2a/client.js';
import { postJson, redactHeaders } from '../providers/http.js';
import { costOf } from '../providers/pricing.js';
import { sleep, uuid } from './util.js';

/**
 * The host agent: an ordinary agent loop whose only tool is "send a message
 * to a remote agent over A2A".
 *
 *   discover (read cards) → model → send_message × N (in parallel) → model → … → answer
 *
 * The A2A-specific parts live in delegate(): building the A2A Message,
 * reusing a contextId per agent, continuing a task that is waiting for input,
 * asking the user before data goes to an external agent, and turning the
 * returned Task into something compact for the model to read.
 */
export const LIMITS = { maxIterations: 8, maxCostUsd: 0.5 };
const MAX_RESULT_CHARS = 6000;

export class HostAgent {
  constructor({ bus, client, registry, getConfig, approve }) {
    this.bus = bus;
    this.client = client;
    this.registry = registry;
    this.getConfig = getConfig;
    this.approve = approve;
    this.running = false;
    this.newSession();
  }

  newSession() {
    this.messages = [];
    this.contexts = {}; // agentId → contextId: one A2A conversation per agent
    this.approved = new Set();
    this.sessionId = uuid().slice(0, 8);
    this.bus.emit('host:session', { sessionId: this.sessionId });
  }

  async run(userText, { signal } = {}) {
    if (this.running) throw new Error('A run is already in progress.');
    this.running = true;
    const cfg = this.getConfig();
    const { provider, model } = cfg;
    const stats = { iterations: 0, input: 0, output: 0, cost: 0, costKnown: true, delegations: 0, t0: performance.now() };
    const startLen = this.messages.length;
    let finalText = '';
    let outcome = 'answered';
    this.bus.emit('host:run:start', { userText, provider: provider.id, model });

    try {
      // 1. Discovery: the host's view of the world is the cards it has read.
      const agents = this.registry.usable();
      this.bus.emit('host:discover', {
        agents: agents.map((a) => ({ id: a.id, name: a.card.name, kind: a.kind, skills: a.card.skills.map((s) => s.name), streaming: a.card.streaming, protocolVersion: a.card.protocolVersion })),
        skipped: this.registry.all().filter((a) => !agents.includes(a)).map((a) => ({ id: a.id, name: a.card?.name ?? a.id, why: !a.enabled ? 'turned off' : a.error ?? a.status })),
      });
      const prompt = buildSystemPrompt(agents);
      const tools = buildTools(agents);
      this.bus.emit('host:prompt', { system: prompt.text, sections: prompt.sections, tools });
      this.messages.push({ role: 'user', content: [{ type: 'text', text: userText }] });

      // 2. The loop.
      while (true) {
        if (stats.iterations >= LIMITS.maxIterations) {
          finalText = `I stopped after ${LIMITS.maxIterations} model calls (the safety limit for one question).`;
          outcome = 'limited';
          break;
        }
        if (stats.costKnown && stats.cost >= LIMITS.maxCostUsd) {
          finalText = `I stopped because this question reached the $${LIMITS.maxCostUsd} cost limit.`;
          outcome = 'limited';
          break;
        }
        stats.iterations++;
        const res = await this.callModel(cfg, { system: prompt.text, tools, messages: this.messages }, stats, signal);
        this.messages.push({ role: 'assistant', content: res.content, native: res.native });
        const calls = res.content.filter((b) => b.type === 'tool_call');
        const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n');
        if (!calls.length) {
          finalText = text;
          outcome = res.stopReason === 'end' ? 'answered' : res.stopReason;
          break;
        }
        if (text) this.bus.emit('host:thinking', { text });
        this.bus.emit('host:plan', { calls: calls.map((c) => ({ id: c.id, agent: c.input?.agent, text: c.input?.text, taskId: c.input?.task_id })) });
        // Independent delegations run in parallel; results go back together.
        const results = await Promise.all(calls.map((c) => this.delegate(c, signal)));
        stats.delegations += calls.length;
        this.messages.push({ role: 'user', content: results });
      }
    } catch (err) {
      outcome = err.name === 'AbortError' ? 'aborted' : 'error';
      this.messages.length = startLen; // keep history valid: drop the half-finished turn
      if (outcome === 'aborted') this.bus.emit('host:aborted', {});
      else this.bus.emit('host:error', { message: err.message, status: err.status });
    } finally {
      this.running = false;
    }

    this.bus.emit('host:run:end', {
      text: finalText, outcome,
      stats: { ...stats, ms: Math.round(performance.now() - stats.t0) },
    });
    return finalText;
  }

  async callModel(cfg, { system, tools, messages }, stats, signal) {
    const { provider, model, apiKey, effort } = cfg;
    const req = provider.buildRequest({ system, tools, messages, model, apiKey, effort });
    this.bus.emit('host:model:request', { iteration: stats.iterations, url: req.url, headers: redactHeaders(req.headers), body: req.body });
    const t0 = performance.now();
    let json;
    for (let attempt = 0; ; attempt++) {
      try {
        json = provider.send ? await provider.send(req, signal) : await postJson(req, signal);
        break;
      } catch (err) {
        if (err.name === 'AbortError' || !err.retryable || attempt >= 2) throw err;
        const wait = err.retryAfterMs ?? 1000 * 2 ** attempt;
        this.bus.emit('host:retry', { attempt: attempt + 1, waitMs: wait, message: err.message });
        await sleep(wait, signal);
      }
    }
    const res = provider.parseResponse(json, model);
    const cost = costOf(model, res.usage, cfg.customPrice);
    stats.input += res.usage.input;
    stats.output += res.usage.output;
    if (cost == null) stats.costKnown = false;
    else stats.cost += cost;
    this.bus.emit('host:model:response', {
      iteration: stats.iterations, ms: Math.round(performance.now() - t0), usage: res.usage, cost,
      content: res.content, reasoning: res.reasoning, stopReason: res.stopReason, raw: json,
    });
    return res;
  }

  /** One send_message tool call → one A2A exchange. */
  async delegate(call, signal) {
    const fail = (message, extra = {}) => {
      this.bus.emit('host:delegate:result', { callId: call.id, agentId: call.input?.agent, ok: false, error: message, ...extra });
      return { type: 'tool_result', id: call.id, name: call.name, output: JSON.stringify({ error: message, ...extra }), isError: true };
    };
    if (call.name !== 'send_message') return fail(`Unknown tool ${call.name}`);
    if (call.inputError) return fail(call.inputError);
    const { agent: agentId, text, task_id: taskId } = call.input ?? {};
    const agent = this.registry.get(agentId);
    if (!agent || !this.registry.usable().includes(agent)) return fail(`No connected agent with id "${agentId}". Use an id from the roster.`);
    if (typeof text !== 'string' || !text.trim()) return fail('text must be a non-empty string.');

    // Data leaves this site only with the user's say-so, once per external agent.
    if (agent.kind === 'external' && !this.approved.has(agent.id)) {
      this.bus.emit('host:approval', { callId: call.id, agentId, host: new URL(agent.card.rpcUrl).host, text });
      const ok = await this.approve({ agent, text, signal });
      this.bus.emit('host:approval:done', { callId: call.id, agentId, ok });
      if (!ok) return fail('The user declined to share this message with that external agent. Continue without it.', { agent: agentId, declined: true });
      this.approved.add(agent.id);
    }

    const message = {
      messageId: uuid(),
      role: 'ROLE_USER',
      parts: [{ text }],
      ...(this.contexts[agent.id] && { contextId: this.contexts[agent.id] }),
      ...(taskId && { taskId }),
    };
    this.bus.emit('host:delegate', { callId: call.id, agentId, agentName: agent.card.name, text, taskId, message, streaming: agent.card.streaming });

    try {
      const r = await this.client.send(agent, message, { signal });
      let summary;
      if (r.task) {
        this.contexts[agent.id] = r.task.contextId ?? this.contexts[agent.id];
        const s = summarizeTask(r.task);
        summary = {
          agent: agent.id, task_id: r.task.id, context_id: r.task.contextId, state: s.state,
          agent_says: s.statusText || undefined,
          artifacts: s.artifacts.length ? s.artifacts : undefined,
        };
      } else {
        this.contexts[agent.id] = r.message.contextId ?? this.contexts[agent.id];
        summary = { agent: agent.id, reply: r.message.parts.filter((p) => p.text).map((p) => p.text).join('\n'), note: 'Direct message reply; no task was created.' };
      }
      let output = JSON.stringify(summary);
      if (output.length > MAX_RESULT_CHARS) output = `${output.slice(0, MAX_RESULT_CHARS)}… [truncated by host]`;
      this.bus.emit('host:delegate:result', { callId: call.id, agentId, ok: true, summary, task: r.task, message: r.message });
      return { type: 'tool_result', id: call.id, name: call.name, output };
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      return fail(err.message, { agent: agentId, kind: err.kind });
    }
  }
}

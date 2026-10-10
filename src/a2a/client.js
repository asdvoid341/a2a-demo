import { a2aFetch } from './transport.js';
import { readSSE } from './sse.js';
import { normalizeCard, cardCandidates } from './card.js';

/**
 * A2A client (JSON-RPC binding).
 *
 *  discover(url)              GET the Agent Card (well-known path), normalize it
 *  send(agent, message)       SendStreamingMessage if the card says it streams, else SendMessage
 *  getTask / cancelTask
 *
 * It also assembles Task objects from stream events (status updates, artifact
 * chunks) and emits every HTTP exchange on the event bus, which is all the
 * "Behind the scenes" panel ever renders.
 *
 * Agents on A2A 0.3 are spoken to in 0.3 (message/send, `kind` fields,
 * lowercase enums) and their replies are converted to the 1.0 shape.
 */
const RPC_ERRORS = {
  '-32700': 'Parse error', '-32600': 'Invalid request', '-32601': 'Method not found', '-32602': 'Invalid params', '-32603': 'Internal error',
  '-32001': 'TaskNotFoundError', '-32002': 'TaskNotCancelableError', '-32003': 'PushNotificationNotSupportedError', '-32004': 'UnsupportedOperationError',
  '-32005': 'ContentTypeNotSupportedError', '-32006': 'InvalidAgentResponseError', '-32007': 'ExtendedAgentCardNotConfiguredError',
  '-32008': 'ExtensionSupportRequiredError', '-32009': 'VersionNotSupportedError',
};
const METHODS_03 = { SendMessage: 'message/send', SendStreamingMessage: 'message/stream', GetTask: 'tasks/get', CancelTask: 'tasks/cancel' };

export class A2AError extends Error {
  /** kind: blocked | auth | http | rpc | protocol */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'A2AError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
let wireSeq = 0;
let rpcSeq = 0;

export class A2AClient {
  constructor({ bus, getProxy }) {
    this.bus = bus;
    this.getProxy = getProxy;
    this.tasks = new Map(); // `${agentId}:${taskId}` → Task as assembled by this client
  }

  /** Wrap a URL for the optional CORS proxy (see proxy/worker.js). */
  viaProxy(url, useProxy) {
    const proxy = useProxy && this.getProxy?.();
    return proxy ? `${proxy.replace(/\/+$/, '')}/?url=${encodeURIComponent(url)}` : url;
  }

  async http(agent, { url, init, label, method, body, streaming }) {
    const wid = ++wireSeq;
    const target = this.viaProxy(url, agent?.useProxy);
    const t0 = performance.now();
    this.bus.emit('wire:request', {
      wid, agentId: agent?.id, agentName: agent?.card?.name ?? new URL(url).host, label, method, url, proxied: target !== url,
      httpMethod: init.method ?? 'GET', headers: init.headers ?? {}, body, streaming,
    });
    let res;
    try {
      res = await a2aFetch(target, init);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      const e = new A2AError('blocked', target !== url
        ? `Couldn’t reach the agent through the proxy (${err.message}). Is the proxy URL right?`
        : 'The browser couldn’t reach this agent. Usually that means it doesn’t allow cross-origin requests (CORS) from web pages, or it is offline. Try turning on the CORS proxy for it.');
      this.bus.emit('wire:response', { wid, agentId: agent?.id, ms: Math.round(performance.now() - t0), error: e.message, errorKind: e.kind });
      throw e;
    }
    return { res, wid, t0 };
  }

  // ── Discovery ─────────────────────────────────────────────────────────────
  async discover(input, { useProxy = false, agentId, signal } = {}) {
    let lastErr;
    const stub = { id: agentId, useProxy };
    for (const url of cardCandidates(input)) {
      try {
        const { res, wid, t0 } = await this.http(stub, { url, init: { headers: { accept: 'application/json' }, signal }, label: 'Agent Card' });
        const text = await res.text();
        let raw = null;
        try { raw = JSON.parse(text); } catch { /* not JSON */ }
        this.bus.emit('wire:response', {
          wid, agentId, status: res.status, ms: Math.round(performance.now() - t0),
          contentType: res.headers.get('content-type'), body: raw ?? text.slice(0, 2000),
        });
        if (res.status === 401 || res.status === 403) throw new A2AError('auth', `The card itself requires authentication (HTTP ${res.status}).`);
        if (!res.ok) { lastErr = new A2AError('http', `HTTP ${res.status} from ${url}`); continue; }
        if (!raw) throw new A2AError('protocol', `${url} did not return JSON.`);
        const card = normalizeCard(raw, url);
        this.bus.emit('card:loaded', { agentId, url, card });
        return card;
      } catch (err) {
        if (err.name === 'AbortError' || err.kind === 'blocked' || err.kind === 'auth' || err.kind === 'protocol') throw err;
        lastErr = err;
      }
    }
    throw lastErr ?? new A2AError('http', 'No Agent Card found.');
  }

  // ── JSON-RPC ──────────────────────────────────────────────────────────────
  rpcBody(agent, method, params) {
    const is03 = agent.card.is03;
    return { jsonrpc: '2.0', id: ++rpcSeq, method: is03 ? METHODS_03[method] : method, params: is03 ? to03(params) : params };
  }

  headers(agent, streaming) {
    const h = { 'content-type': 'application/json', accept: streaming ? 'text/event-stream' : 'application/json' };
    if (!agent.card.is03) h['A2A-Version'] = '1.0';
    return h;
  }

  async call(agent, method, params, { signal } = {}) {
    const body = this.rpcBody(agent, method, params);
    const { res, wid, t0 } = await this.http(agent, {
      url: agent.card.rpcUrl, label: method, method, body,
      init: { method: 'POST', headers: this.headers(agent, false), body: JSON.stringify(body), signal },
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* handled below */ }
    this.bus.emit('wire:response', { wid, agentId: agent.id, status: res.status, ms: Math.round(performance.now() - t0), contentType: res.headers.get('content-type'), body: json ?? text.slice(0, 2000) });
    checkHttp(res, json, text);
    if (json.error) throw rpcError(json.error);
    return agent.card.is03 ? from03(json.result) : json.result;
  }

  /**
   * Send a message. Streams when the agent supports it.
   * Returns { task?, message?, streamed }.
   */
  async send(agent, message, { signal } = {}) {
    const params = { message, configuration: { acceptedOutputModes: ['text/plain', 'application/json'] } };
    if (!agent.card.streaming) {
      const result = await this.call(agent, 'SendMessage', params, { signal });
      this.bus.emit('wire:result', { agentId: agent.id, result });
      if (result.task) return { task: this.applyEvent(agent, { task: result.task }), streamed: false };
      if (result.message) { this.applyEvent(agent, result); return { message: result.message, streamed: false }; }
      throw new A2AError('protocol', 'SendMessage returned neither a task nor a message.');
    }

    const body = this.rpcBody(agent, 'SendStreamingMessage', params);
    const { res, wid, t0 } = await this.http(agent, {
      url: agent.card.rpcUrl, label: 'SendStreamingMessage', method: 'SendStreamingMessage', body, streaming: true,
      init: { method: 'POST', headers: this.headers(agent, true), body: JSON.stringify(body), signal },
    });
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('text/event-stream')) {
      // An error (or a server that ignored streaming) comes back as plain JSON.
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* handled below */ }
      this.bus.emit('wire:response', { wid, agentId: agent.id, status: res.status, ms: Math.round(performance.now() - t0), contentType: type, body: json ?? text.slice(0, 2000) });
      checkHttp(res, json, text);
      if (json.error) throw rpcError(json.error);
      const r = agent.card.is03 ? from03(json.result) : json.result;
      if (r.task) return { task: this.applyEvent(agent, r), streamed: false };
      if (r.message) return { message: r.message, streamed: false };
      throw new A2AError('protocol', 'Unexpected response to SendStreamingMessage.');
    }

    this.bus.emit('wire:response', { wid, agentId: agent.id, status: res.status, ms: Math.round(performance.now() - t0), contentType: type, streaming: true });
    let task = null;
    let reply = null;
    let n = 0;
    for await (const data of readSSE(res)) {
      let frame;
      try { frame = JSON.parse(data); } catch { continue; }
      n++;
      if (frame.error) {
        this.bus.emit('wire:event', { wid, agentId: agent.id, n, frame });
        throw rpcError(frame.error);
      }
      const ev = agent.card.is03 ? from03(frame.result) : frame.result;
      this.bus.emit('wire:event', { wid, agentId: agent.id, n, frame, kind: Object.keys(ev ?? {})[0], ms: Math.round(performance.now() - t0) });
      if (ev.message) reply = ev.message;
      const t = this.applyEvent(agent, ev);
      if (t) task = t;
    }
    this.bus.emit('wire:end', { wid, agentId: agent.id, events: n, ms: Math.round(performance.now() - t0) });
    if (task) return { task, streamed: true };
    if (reply) return { message: reply, streamed: true };
    throw new A2AError('protocol', 'The stream ended without a task or message.');
  }

  async getTask(agent, id, opts) {
    const task = await this.call(agent, 'GetTask', { id, historyLength: 10 }, opts);
    return this.applyEvent(agent, { task: task.task ?? task });
  }

  async cancelTask(agent, id, opts) {
    const task = await this.call(agent, 'CancelTask', { id }, opts);
    return this.applyEvent(agent, { task: task.task ?? task });
  }

  // ── Task assembly from events ─────────────────────────────────────────────
  applyEvent(agent, ev) {
    if (ev.message && !ev.message.taskId) {
      this.bus.emit('task:message', { agentId: agent.id, message: ev.message });
      return null;
    }
    const taskId = ev.task?.id ?? ev.statusUpdate?.taskId ?? ev.artifactUpdate?.taskId ?? ev.message?.taskId;
    if (!taskId) return null;
    const key = `${agent.id}:${taskId}`;
    const prev = this.tasks.get(key);
    const prevState = prev?.status?.state ?? null;
    let t = prev ? clone(prev) : { id: taskId, contextId: ev.statusUpdate?.contextId ?? ev.artifactUpdate?.contextId, status: { state: 'TASK_STATE_SUBMITTED' }, artifacts: [], history: [] };
    let change = '';

    if (ev.task) {
      t = { ...clone(ev.task), artifacts: ev.task.artifacts ?? [], history: ev.task.history ?? [] };
      change = 'snapshot';
    } else if (ev.statusUpdate) {
      t.status = clone(ev.statusUpdate.status);
      if (t.status.message) t.history.push(clone(t.status.message));
      change = 'status';
    } else if (ev.artifactUpdate) {
      const { artifact, append } = ev.artifactUpdate;
      const i = t.artifacts.findIndex((a) => a.artifactId === artifact.artifactId);
      if (i >= 0 && append) t.artifacts[i] = { ...t.artifacts[i], parts: [...t.artifacts[i].parts, ...clone(artifact.parts)] };
      else if (i >= 0) t.artifacts[i] = clone(artifact);
      else t.artifacts.push(clone(artifact));
      change = append ? 'artifact-append' : 'artifact';
    } else if (ev.message) {
      t.history.push(clone(ev.message));
      change = 'message';
    }
    this.tasks.set(key, t);
    this.bus.emit('task:update', { agentId: agent.id, task: t, prevState, state: t.status?.state, change, event: ev });
    return t;
  }
}

function checkHttp(res, json, text) {
  if (res.status === 401 || res.status === 403) throw new A2AError('auth', `The agent requires authentication (HTTP ${res.status}).`, { status: res.status });
  if (!json) throw new A2AError(res.ok ? 'protocol' : 'http', res.ok ? 'The agent replied with something that is not JSON.' : `HTTP ${res.status}: ${text.slice(0, 160)}`, { status: res.status });
}

function rpcError(e) {
  const name = RPC_ERRORS[String(e.code)] ?? 'JSON-RPC error';
  return new A2AError('rpc', `${name} (${e.code}): ${e.message}`, { code: e.code, rpcName: name, data: e.data });
}

// ── A2A 0.3 compatibility ────────────────────────────────────────────────────
function to03(params) {
  if (!params?.message) return params;
  const m = params.message;
  return {
    ...params,
    message: {
      kind: 'message',
      messageId: m.messageId,
      role: m.role === 'ROLE_AGENT' ? 'agent' : 'user',
      parts: m.parts.map((p) => (p.text != null ? { kind: 'text', text: p.text } : p.data != null ? { kind: 'data', data: p.data } : { kind: 'file', file: { uri: p.url, mimeType: p.mediaType } })),
      ...(m.taskId && { taskId: m.taskId }),
      ...(m.contextId && { contextId: m.contextId }),
    },
  };
}

const state03 = (s) => (s && !s.startsWith('TASK_STATE_') ? `TASK_STATE_${s.toUpperCase().replace(/-/g, '_')}` : s);
const role03 = (r) => (r === 'agent' ? 'ROLE_AGENT' : r === 'user' ? 'ROLE_USER' : r);
const part03 = (p) => {
  if (p.kind === 'text' || p.text != null) return { text: p.text };
  if (p.kind === 'data' || p.data != null) return { data: p.data, mediaType: 'application/json' };
  if (p.kind === 'file') return p.file?.uri ? { url: p.file.uri, mediaType: p.file.mimeType } : { raw: p.file?.bytes, mediaType: p.file?.mimeType, filename: p.file?.name };
  return p;
};
const msg03 = (m) => m && { messageId: m.messageId, role: role03(m.role), parts: (m.parts ?? []).map(part03), taskId: m.taskId, contextId: m.contextId };
const status03 = (s) => s && { state: state03(s.state), timestamp: s.timestamp, ...(s.message && { message: msg03(s.message) }) };
const art03 = (a) => a && { artifactId: a.artifactId, name: a.name, description: a.description, parts: (a.parts ?? []).map(part03) };

function from03(r) {
  if (!r || typeof r !== 'object') return r;
  if (r.task || r.message || r.statusUpdate || r.artifactUpdate) return r; // already 1.0-shaped
  switch (r.kind) {
    case 'task':
      return { task: { id: r.id, contextId: r.contextId, status: status03(r.status), artifacts: (r.artifacts ?? []).map(art03), history: (r.history ?? []).map(msg03) } };
    case 'message':
      return { message: msg03(r) };
    case 'status-update':
      return { statusUpdate: { taskId: r.taskId, contextId: r.contextId, status: status03(r.status) } };
    case 'artifact-update':
      return { artifactUpdate: { taskId: r.taskId, contextId: r.contextId, artifact: art03(r.artifact), append: r.append, lastChunk: r.lastChunk } };
    default:
      // GetTask/CancelTask in 0.3 return a bare Task.
      if (r.id && r.status) return { task: { id: r.id, contextId: r.contextId, status: status03(r.status), artifacts: (r.artifacts ?? []).map(art03), history: (r.history ?? []).map(msg03) } };
      return r;
  }
}

/** Text and data from a task's artifacts (and its last status message), for the host and the UI. */
export function summarizeTask(task) {
  const statusText = (task.status?.message?.parts ?? []).filter((p) => p.text).map((p) => p.text).join('\n');
  return {
    state: task.status?.state,
    statusText,
    artifacts: (task.artifacts ?? []).map((a) => ({
      name: a.name ?? a.artifactId,
      text: a.parts.filter((p) => p.text != null).map((p) => p.text).join('\n'),
      data: a.parts.find((p) => p.data != null)?.data ?? null,
    })),
  };
}

/**
 * A tiny A2A v1.0 server (JSON-RPC binding), written as a classic script so the
 * same code runs inside the Service Worker (sw.js) and, as a fallback, in the
 * page itself.
 *
 * It implements the parts of the spec this demo needs:
 *   GET  {base}/.well-known/agent-card.json      → the Agent Card
 *   POST {base}/a2a/v1   SendMessage             → { task } or { message }
 *                        SendStreamingMessage    → text/event-stream of StreamResponse
 *                        GetTask, CancelTask
 * plus the task lifecycle (SUBMITTED → WORKING → INPUT_REQUIRED / COMPLETED /
 * FAILED / CANCELED / REJECTED), multi-turn tasks and chunked artifacts.
 *
 * An agent is just { id, card(baseUrl), quickReply?(msg), execute(ctx) }.
 */
(function (g) {
  'use strict';

  const TERMINAL = ['TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_REJECTED'];
  const INTERRUPTED = ['TASK_STATE_INPUT_REQUIRED', 'TASK_STATE_AUTH_REQUIRED'];
  const ERR = {
    PARSE: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601, INVALID_PARAMS: -32602, INTERNAL: -32603,
    TASK_NOT_FOUND: -32001, TASK_NOT_CANCELABLE: -32002, UNSUPPORTED: -32004, VERSION: -32009,
  };
  const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, a2a-version, a2a-extensions, authorization',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  };

  const uuid = () => crypto.randomUUID();
  const now = () => new Date().toISOString();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clone = (v) => JSON.parse(JSON.stringify(v));

  // ── Task store: memory + IndexedDB, so a waiting (INPUT_REQUIRED) task
  //    survives the Service Worker being stopped while the user thinks. ──────
  const DB_NAME = 'a2a-demo-server';
  let dbp = null;
  function db() {
    if (!g.indexedDB) return Promise.resolve(null);
    dbp ??= new Promise((resolve) => {
      const req = g.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('tasks', { keyPath: 'key' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    return dbp;
  }
  const mem = new Map();
  const store = {
    async get(agentId, taskId) {
      const key = `${agentId}:${taskId}`;
      if (mem.has(key)) return mem.get(key);
      const d = await db();
      if (!d) return null;
      return new Promise((resolve) => {
        const r = d.transaction('tasks').objectStore('tasks').get(key);
        r.onsuccess = () => {
          if (r.result) mem.set(key, r.result);
          resolve(r.result ?? null);
        };
        r.onerror = () => resolve(null);
      });
    },
    async put(agentId, rec) {
      const key = `${agentId}:${rec.task.id}`;
      rec.key = key;
      mem.set(key, rec);
      const d = await db();
      if (!d) return;
      try { d.transaction('tasks', 'readwrite').objectStore('tasks').put(clone(rec)); } catch { /* best effort */ }
    },
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const textOf = (msg) => (msg?.parts ?? []).filter((p) => typeof p.text === 'string').map((p) => p.text).join('\n').trim();
  const dataOf = (msg) => (msg?.parts ?? []).find((p) => p.data && typeof p.data === 'object')?.data ?? null;
  const agentMessage = (text, taskId, contextId) => ({
    messageId: uuid(), role: 'ROLE_AGENT', parts: [{ text }], ...(taskId && { taskId }), ...(contextId && { contextId }),
  });
  const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers: { 'content-type': 'application/json', ...CORS } });
  const rpcError = (id, code, message, data) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data && { data }) } });
  const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
  class RpcError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  function createAgentServer(agent) {
    const running = new Map(); // taskId → AbortController

    function validateMessage(m) {
      if (!m || typeof m !== 'object') throw new RpcError(ERR.INVALID_PARAMS, 'params.message is required');
      if (!m.messageId) throw new RpcError(ERR.INVALID_PARAMS, 'message.messageId is required');
      if (m.role !== 'ROLE_USER') throw new RpcError(ERR.INVALID_PARAMS, `message.role must be "ROLE_USER" (got ${JSON.stringify(m.role)})`);
      if (!Array.isArray(m.parts) || !m.parts.length) throw new RpcError(ERR.INVALID_PARAMS, 'message.parts must be a non-empty array');
      for (const p of m.parts) {
        const n = ['text', 'raw', 'url', 'data'].filter((k) => p[k] !== undefined).length;
        if (n !== 1) throw new RpcError(ERR.INVALID_PARAMS, 'each Part must contain exactly one of text, raw, url or data');
      }
    }

    /**
     * Start or continue a task. `emit(streamResponse)` receives every event.
     * Resolves with { task } or { message } once the task stops (terminal or
     * interrupted), which is what a non-streaming SendMessage returns.
     */
    async function send(params, emit) {
      const msg = params?.message;
      validateMessage(msg);

      // A plain question can be answered with a Message: no task is created.
      if (!msg.taskId && agent.quickReply) {
        const text = agent.quickReply(textOf(msg), dataOf(msg));
        if (text) {
          const reply = agentMessage(text, null, msg.contextId ?? uuid());
          emit({ message: reply });
          return { message: reply };
        }
      }

      let rec;
      if (msg.taskId) {
        rec = await store.get(agent.id, msg.taskId);
        if (!rec) throw new RpcError(ERR.TASK_NOT_FOUND, `Task ${msg.taskId} not found`);
        const state = rec.task.status.state;
        if (TERMINAL.includes(state)) throw new RpcError(ERR.UNSUPPORTED, `Task ${msg.taskId} is already ${state} and cannot be restarted`);
        if (!INTERRUPTED.includes(state)) throw new RpcError(ERR.UNSUPPORTED, `Task ${msg.taskId} is ${state}; it only accepts new messages while waiting for input`);
        rec.task.history.push({ ...msg, contextId: rec.task.contextId });
        emit({ task: clone(rec.task) });
      } else {
        const id = uuid();
        const contextId = msg.contextId ?? uuid();
        rec = {
          task: {
            id, contextId,
            status: { state: 'TASK_STATE_SUBMITTED', timestamp: now() },
            artifacts: [],
            history: [{ ...msg, taskId: id, contextId }],
          },
          internal: {},
        };
        await store.put(agent.id, rec);
        emit({ task: clone(rec.task) });
      }

      const task = rec.task;
      const ctrl = new AbortController();
      running.set(task.id, ctrl);
      let stopped = false;

      const setStatus = async (state, text) => {
        if (stopped || ctrl.signal.aborted) return;
        const status = { state, timestamp: now(), ...(text && { message: agentMessage(text, task.id, task.contextId) }) };
        task.status = status;
        if (status.message) task.history.push(status.message);
        if (TERMINAL.includes(state) || INTERRUPTED.includes(state)) stopped = true;
        await store.put(agent.id, rec);
        emit({ statusUpdate: { taskId: task.id, contextId: task.contextId, status: clone(status) } });
      };

      const ctx = {
        task: clone(task),
        message: msg,
        text: textOf(msg),
        data: dataOf(msg),
        resumed: !!msg.taskId,
        internal: rec.internal,
        signal: ctrl.signal,
        sleep: (ms) => sleep(ms),
        working: (text) => setStatus('TASK_STATE_WORKING', text),
        inputRequired: (text) => setStatus('TASK_STATE_INPUT_REQUIRED', text),
        complete: (text) => setStatus('TASK_STATE_COMPLETED', text),
        fail: (text) => setStatus('TASK_STATE_FAILED', text),
        reject: (text) => setStatus('TASK_STATE_REJECTED', text),
        /** Add or extend an artifact. With append, parts are added to an earlier chunk. */
        async artifact({ artifactId, name, description, parts, append = false, lastChunk = true }) {
          if (stopped || ctrl.signal.aborted) return;
          const id = artifactId ?? uuid();
          let a = task.artifacts.find((x) => x.artifactId === id);
          if (a && append) a.parts.push(...parts);
          else {
            a = { artifactId: id, ...(name && { name }), ...(description && { description }), parts: [...parts] };
            task.artifacts = task.artifacts.filter((x) => x.artifactId !== id).concat(a);
          }
          await store.put(agent.id, rec);
          emit({
            artifactUpdate: {
              taskId: task.id, contextId: task.contextId,
              artifact: { artifactId: id, ...(name && { name }), ...(description && { description }), parts: clone(parts) },
              append, lastChunk,
            },
          });
          return id;
        },
      };

      try {
        await agent.execute(ctx);
        if (!stopped) await setStatus('TASK_STATE_COMPLETED');
      } catch (err) {
        if (ctrl.signal.aborted) { /* CancelTask already set the state */ }
        else await setStatus('TASK_STATE_FAILED', `Internal error: ${err.message}`);
      } finally {
        running.delete(task.id);
      }
      return { task: clone(task) };
    }

    async function getTask(params) {
      if (!params?.id) throw new RpcError(ERR.INVALID_PARAMS, 'params.id is required');
      const rec = await store.get(agent.id, params.id);
      if (!rec) throw new RpcError(ERR.TASK_NOT_FOUND, `Task ${params.id} not found`);
      const t = clone(rec.task);
      if (Number.isInteger(params.historyLength)) t.history = params.historyLength === 0 ? [] : t.history.slice(-params.historyLength);
      return t;
    }

    async function cancelTask(params) {
      if (!params?.id) throw new RpcError(ERR.INVALID_PARAMS, 'params.id is required');
      const rec = await store.get(agent.id, params.id);
      if (!rec) throw new RpcError(ERR.TASK_NOT_FOUND, `Task ${params.id} not found`);
      if (TERMINAL.includes(rec.task.status.state)) throw new RpcError(ERR.TASK_NOT_CANCELABLE, `Task is already ${rec.task.status.state}`);
      running.get(params.id)?.abort();
      rec.task.status = { state: 'TASK_STATE_CANCELED', timestamp: now(), message: agentMessage('Canceled at the client’s request.', rec.task.id, rec.task.contextId) };
      await store.put(agent.id, rec);
      return clone(rec.task);
    }

    /** Route one HTTP request. `base` is this agent's base URL, ending in "/". */
    async function handle(request, base) {
      const url = new URL(request.url);
      const path = url.href.slice(base.length).split('?')[0];

      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (request.method === 'GET' && (path === '.well-known/agent-card.json' || path === '')) {
        return json(agent.card(base));
      }
      if (path !== 'a2a/v1') return json({ error: `No route for ${request.method} /${path}` }, 404);
      if (request.method !== 'POST') return json({ error: 'Use POST for JSON-RPC' }, 405);

      let body;
      try { body = await request.json(); } catch { return json(rpcError(null, ERR.PARSE, 'Request body is not valid JSON')); }
      const { id, method, params } = body ?? {};
      if (body?.jsonrpc !== '2.0' || typeof method !== 'string') return json(rpcError(id, ERR.INVALID_REQUEST, 'Not a JSON-RPC 2.0 request'));

      // The client must say which protocol version it speaks (an empty value means 0.3).
      const version = request.headers.get('a2a-version') || url.searchParams.get('A2A-Version') || '';
      if (!/^1(\.\d+)?$/.test(version)) {
        return json(rpcError(id, ERR.VERSION, `Version ${version || '0.3 (no A2A-Version header)'} is not supported. This agent speaks A2A 1.0.`, { supportedVersions: ['1.0'] }));
      }

      try {
        switch (method) {
          case 'SendMessage': {
            const result = await send(params, () => {});
            return json(rpcResult(id, result));
          }
          case 'SendStreamingMessage': {
            if (!agent.card(base).capabilities?.streaming) throw new RpcError(ERR.UNSUPPORTED, 'This agent does not support streaming. Use SendMessage.');
            validateMessage(params?.message);
            const enc = new TextEncoder();
            const stream = new ReadableStream({
              async start(controller) {
                const emit = (ev) => controller.enqueue(enc.encode(`data: ${JSON.stringify(rpcResult(id, ev))}\n\n`));
                try {
                  await send(params, emit);
                } catch (err) {
                  controller.enqueue(enc.encode(`data: ${JSON.stringify(rpcError(id, err.code ?? ERR.INTERNAL, err.message))}\n\n`));
                }
                controller.close();
              },
            });
            return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', ...CORS } });
          }
          case 'GetTask':
            return json(rpcResult(id, await getTask(params)));
          case 'CancelTask':
            return json(rpcResult(id, await cancelTask(params)));
          default: {
            const hint = /\//.test(method) ? ` "${method}" is an A2A 0.3 method name; 1.0 uses PascalCase (e.g. SendMessage).` : '';
            return json(rpcError(id, ERR.METHOD_NOT_FOUND, `Method not found: ${method}.${hint}`));
          }
        }
      } catch (err) {
        return json(rpcError(id, err.code ?? ERR.INTERNAL, err.message));
      }
    }

    return { id: agent.id, handle, card: agent.card };
  }

  /** All built-in agents, keyed by id. Agent scripts call A2AServer.register(). */
  const agents = {};
  g.A2AServer = {
    register(agent) { agents[agent.id] = createAgentServer(agent); },
    agents,
    /** Route a request to the agent whose base URL it falls under, or return null. */
    async route(request, root) {
      const url = new URL(request.url);
      if (!url.href.startsWith(root)) return null;
      const [id] = url.href.slice(root.length).split('/');
      const server = agents[id];
      if (!server) return json({ error: `No built-in agent called "${id}"` }, 404);
      return server.handle(request, `${root}${id}/`);
    },
    helpers: { textOf, dataOf, sleep },
  };
})(globalThis);

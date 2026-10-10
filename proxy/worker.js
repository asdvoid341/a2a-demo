/**
 * A2A demo companion: one Cloudflare Worker, two jobs.
 *
 * 1. CORS proxy      GET/POST  /?url=https://some-agent.example.com/...
 *    Lets the browser demo talk to A2A agents that don't send CORS headers.
 *    Only https targets on public hosts; set ALLOWED_ORIGINS to lock it to your page.
 *
 * 2. Phrasebook Agent  GET /.well-known/agent-card.json, POST /a2a/v1
 *    A real, cross-origin A2A 1.0 agent (JSON-RPC, streaming) you can add to
 *    the demo with "Add agent". Stateless: it finishes every task in one go.
 *
 * Deploy: see README.md in this folder (npx wrangler deploy).
 */
const CORS_HEADERS = {
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, accept, a2a-version, a2a-extensions, authorization',
  'access-control-expose-headers': 'content-type',
  'access-control-max-age': '86400',
};
const FORWARD = ['content-type', 'accept', 'a2a-version', 'a2a-extensions', 'authorization'];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') ?? '';
    const allowed = (env.ALLOWED_ORIGINS ?? '*').split(',').map((s) => s.trim()).filter(Boolean);
    const allowOrigin = allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : null;
    const withCors = (res, open = false) => {
      const h = new Headers(res.headers);
      for (const [k, v] of Object.entries(CORS_HEADERS)) h.set(k, v);
      if (open || allowOrigin) h.set('access-control-allow-origin', open ? '*' : allowOrigin);
      h.set('vary', 'origin');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    };

    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), !new URL(request.url).searchParams.has('url'));
    const url = new URL(request.url);

    const target = url.searchParams.get('url');
    if (target) {
      if (!allowOrigin) return withCors(json({ error: `Origin ${origin || '(none)'} may not use this proxy.` }, 403));
      return withCors(await proxy(request, target));
    }

    if (url.pathname === '/.well-known/agent-card.json') return withCors(json(card(url.origin)), true);
    if (url.pathname === '/a2a/v1') {
      if (request.method !== 'POST') return withCors(json({ error: 'Use POST for JSON-RPC' }, 405), true);
      return withCors(await rpc(request), true);
    }
    return withCors(new Response('A2A demo companion.\n- CORS proxy: /?url=<https URL>\n- Phrasebook Agent card: /.well-known/agent-card.json\n', { headers: { 'content-type': 'text/plain' } }));
  },
};

// ── 1. CORS proxy ─────────────────────────────────────────────────────────────
async function proxy(request, target) {
  let t;
  try { t = new URL(target); } catch { return json({ error: 'url is not a valid URL' }, 400); }
  if (t.protocol !== 'https:') return json({ error: 'Only https:// targets are allowed' }, 400);
  if (isPrivateHost(t.hostname)) return json({ error: 'Private and local addresses are not allowed' }, 400);
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'Only GET and POST' }, 405);

  const headers = new Headers();
  for (const k of FORWARD) {
    const v = request.headers.get(k);
    if (v) headers.set(k, v);
  }
  try {
    const res = await fetch(t, { method: request.method, headers, body: request.method === 'POST' ? request.body : undefined, redirect: 'follow' });
    // Pass the body through untouched, so Server-Sent Events keep streaming.
    const out = new Headers();
    for (const k of ['content-type', 'cache-control']) if (res.headers.get(k)) out.set(k, res.headers.get(k));
    return new Response(res.body, { status: res.status, headers: out });
  } catch (err) {
    return json({ error: `Upstream fetch failed: ${err.message}` }, 502);
  }
}

function isPrivateHost(h) {
  h = h.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return true;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  return false;
}

// ── 2. Phrasebook Agent (A2A 1.0, JSON-RPC) ───────────────────────────────────
const PHRASES = {
  Portuguese: { places: ['lisbon', 'porto', 'portugal', 'rio', 'brazil', 'são paulo', 'sao paulo'], hello: 'Olá', thanks: 'Obrigado / Obrigada', please: 'Por favor', sorry: 'Desculpe', price: 'Quanto custa?', bill: 'A conta, por favor', where: 'Onde fica…?', cheers: 'Saúde!' },
  Spanish: { places: ['madrid', 'barcelona', 'seville', 'valencia', 'spain', 'mexico', 'buenos aires', 'lima', 'bogotá', 'bogota'], hello: 'Hola', thanks: 'Gracias', please: 'Por favor', sorry: 'Perdón', price: '¿Cuánto cuesta?', bill: 'La cuenta, por favor', where: '¿Dónde está…?', cheers: '¡Salud!' },
  French: { places: ['paris', 'nice', 'lyon', 'marseille', 'france', 'montreal', 'brussels', 'geneva'], hello: 'Bonjour', thanks: 'Merci', please: 'S’il vous plaît', sorry: 'Pardon', price: 'C’est combien ?', bill: 'L’addition, s’il vous plaît', where: 'Où est… ?', cheers: 'Santé !' },
  Italian: { places: ['rome', 'milan', 'florence', 'venice', 'naples', 'italy'], hello: 'Ciao / Buongiorno', thanks: 'Grazie', please: 'Per favore', sorry: 'Mi scusi', price: 'Quanto costa?', bill: 'Il conto, per favore', where: 'Dov’è…?', cheers: 'Salute!' },
  German: { places: ['berlin', 'munich', 'hamburg', 'vienna', 'zurich', 'germany', 'austria'], hello: 'Hallo / Guten Tag', thanks: 'Danke', please: 'Bitte', sorry: 'Entschuldigung', price: 'Was kostet das?', bill: 'Die Rechnung, bitte', where: 'Wo ist…?', cheers: 'Prost!' },
  Japanese: { places: ['tokyo', 'kyoto', 'osaka', 'japan', 'sapporo', 'hiroshima'], hello: 'Konnichiwa (こんにちは)', thanks: 'Arigatō gozaimasu (ありがとうございます)', please: 'Onegaishimasu (お願いします)', sorry: 'Sumimasen (すみません)', price: 'Ikura desu ka? (いくらですか)', bill: 'O-kaikei onegaishimasu (お会計お願いします)', where: '…wa doko desu ka? (…はどこですか)', cheers: 'Kanpai! (乾杯)' },
  Thai: { places: ['bangkok', 'chiang mai', 'phuket', 'thailand'], hello: 'Sawasdee krap/ka', thanks: 'Khop khun krap/ka', please: 'Karuna', sorry: 'Kho thot', price: 'Tao rai?', bill: 'Check bin', where: '…yoo tee nai?', cheers: 'Chon kaew!' },
  Turkish: { places: ['istanbul', 'ankara', 'izmir', 'turkey', 'türkiye'], hello: 'Merhaba', thanks: 'Teşekkürler', please: 'Lütfen', sorry: 'Pardon', price: 'Ne kadar?', bill: 'Hesap, lütfen', where: '…nerede?', cheers: 'Şerefe!' },
  Hindi: { places: ['delhi', 'mumbai', 'jaipur', 'agra', 'varanasi', 'india'], hello: 'Namaste (नमस्ते)', thanks: 'Dhanyavaad (धन्यवाद)', please: 'Kripya (कृपया)', sorry: 'Maaf kijiye (माफ़ कीजिए)', price: 'Kitne ka hai? (कितने का है?)', bill: 'Bill dijiye (बिल दीजिए)', where: '…kahaan hai? (…कहाँ है?)', cheers: 'Cheers!' },
};
const LABELS = { hello: 'Hello', thanks: 'Thank you', please: 'Please', sorry: 'Excuse me / sorry', price: 'How much is it?', bill: 'The bill, please', where: 'Where is…?', cheers: 'Cheers!' };

function card(origin) {
  return {
    name: 'Phrasebook Agent',
    description: 'Essential travel phrases (hello, thank you, how much, the bill…) for a destination city or a language. A cross-origin A2A agent running on Cloudflare Workers.',
    version: '1.0.0',
    supportedInterfaces: [{ url: `${origin}/a2a/v1`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
    provider: { organization: 'A2A Demo companion (self-hosted)', url: origin },
    capabilities: { streaming: true, pushNotifications: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: [{
      id: 'phrases',
      name: 'Travel phrases',
      description: `Eight phrases every visitor needs, in the local language of a city or in a named language. Languages: ${Object.keys(PHRASES).join(', ')}.`,
      tags: ['phrases', 'language', 'translation', 'travel'],
      examples: ['Useful phrases for a trip to Lisbon', 'Basic Japanese phrases'],
    }],
  };
}

async function rpc(request) {
  let body;
  try { body = await request.json(); } catch { return json(err(null, -32700, 'Request body is not valid JSON')); }
  const { id, method, params } = body ?? {};
  const version = request.headers.get('a2a-version') ?? '';
  if (!/^1(\.\d+)?$/.test(version)) return json(err(id, -32009, `Version ${version || '0.3 (no A2A-Version header)'} is not supported. This agent speaks A2A 1.0.`));
  if (method === 'GetTask' || method === 'CancelTask') return json(err(id, -32001, 'This agent is stateless and keeps no tasks after replying.'));
  if (method !== 'SendMessage' && method !== 'SendStreamingMessage') return json(err(id, -32601, `Method not found: ${method}`));
  const msg = params?.message;
  if (!msg?.messageId || msg.role !== 'ROLE_USER' || !Array.isArray(msg.parts)) return json(err(id, -32602, 'params.message must have messageId, role "ROLE_USER" and parts'));
  if (msg.taskId) return json(err(id, -32001, 'This agent is stateless; it cannot continue an earlier task.'));

  const text = msg.parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join(' ');
  const taskId = crypto.randomUUID();
  const contextId = msg.contextId ?? crypto.randomUUID();
  const now = () => new Date().toISOString();
  const agentMsg = (t) => ({ messageId: crypto.randomUUID(), role: 'ROLE_AGENT', parts: [{ text: t }], taskId, contextId });

  const lower = text.toLowerCase();
  const lang = Object.keys(PHRASES).find((l) => lower.includes(l.toLowerCase())) ?? Object.keys(PHRASES).find((l) => PHRASES[l].places.some((p) => lower.includes(p)));
  const events = [{ task: { id: taskId, contextId, status: { state: 'TASK_STATE_SUBMITTED', timestamp: now() }, history: [{ ...msg, taskId, contextId }] } }];
  let final;
  if (!lang) {
    final = { state: 'TASK_STATE_REJECTED', timestamp: now(), message: agentMsg(`I don’t know that destination. I have phrases in: ${Object.keys(PHRASES).join(', ')}.`) };
  } else {
    events.push({ statusUpdate: { taskId, contextId, status: { state: 'TASK_STATE_WORKING', timestamp: now(), message: agentMsg(`Looking up ${lang} phrases…`) } } });
    const p = PHRASES[lang];
    const rows = Object.keys(LABELS).map((k) => ({ english: LABELS[k], local: p[k] }));
    events.push({
      artifactUpdate: {
        taskId, contextId, lastChunk: true,
        artifact: {
          artifactId: crypto.randomUUID(), name: 'phrases',
          parts: [{ text: `${lang} phrases:\n${rows.map((r) => `- ${r.english}: ${r.local}`).join('\n')}` }, { data: { language: lang, phrases: rows }, mediaType: 'application/json' }],
        },
      },
    });
    final = { state: 'TASK_STATE_COMPLETED', timestamp: now(), message: agentMsg(`Here are 8 essential ${lang} phrases.`) };
  }
  events.push({ statusUpdate: { taskId, contextId, status: final } });

  if (method === 'SendMessage') {
    const art = events.find((e) => e.artifactUpdate)?.artifactUpdate.artifact;
    return json({ jsonrpc: '2.0', id, result: { task: { id: taskId, contextId, status: final, artifacts: art ? [art] : [], history: [{ ...msg, taskId, contextId }, final.message] } } });
  }
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(c) {
      for (const ev of events) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ jsonrpc: '2.0', id, result: ev })}\n\n`));
        await new Promise((r) => setTimeout(r, 250));
      }
      c.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } });
}

const err = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { 'content-type': 'application/json' } });
}

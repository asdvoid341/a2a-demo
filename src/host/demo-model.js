import { estimateTokens } from './util.js';

/**
 * The scripted host model (demo mode, no API key).
 *
 * A small rule-based planner that answers in the Anthropic Messages format:
 *   - new request  → parse city / days / money, then call the right agents in parallel
 *   - agent waiting (INPUT_REQUIRED) → relay its question to the user
 *   - user replies → send the answer to the SAME task_id
 *   - all done     → combine the artifacts into a day-by-day plan
 * It works for any city or amount, not just the suggested prompts. Everything it
 * delegates goes through the real A2A client to the real agents.
 */
const CITY_CCY = {
  lisbon: 'EUR', porto: 'EUR', paris: 'EUR', rome: 'EUR', milan: 'EUR', barcelona: 'EUR', madrid: 'EUR', berlin: 'EUR', munich: 'EUR',
  amsterdam: 'EUR', vienna: 'EUR', athens: 'EUR', dublin: 'EUR', brussels: 'EUR', florence: 'EUR', venice: 'EUR', nice: 'EUR',
  prague: 'CZK', budapest: 'HUF', warsaw: 'PLN', krakow: 'PLN', copenhagen: 'DKK', stockholm: 'SEK', oslo: 'NOK', reykjavik: 'ISK',
  london: 'GBP', edinburgh: 'GBP', zurich: 'CHF', geneva: 'CHF', istanbul: 'TRY', tokyo: 'JPY', kyoto: 'JPY', osaka: 'JPY',
  seoul: 'KRW', bangkok: 'THB', singapore: 'SGD', 'hong kong': 'HKD', 'kuala lumpur': 'MYR', bali: 'IDR', jakarta: 'IDR', manila: 'PHP',
  sydney: 'AUD', melbourne: 'AUD', auckland: 'NZD', 'new york': 'USD', 'san francisco': 'USD', chicago: 'USD', 'los angeles': 'USD',
  toronto: 'CAD', vancouver: 'CAD', 'mexico city': 'MXN', 'rio de janeiro': 'BRL', 'cape town': 'ZAR', delhi: 'INR', mumbai: 'INR',
  goa: 'INR', bengaluru: 'INR', jaipur: 'INR', beijing: 'CNY', shanghai: 'CNY', 'tel aviv': 'ILS',
};
const CCY_WORDS = { rupee: 'INR', rupees: 'INR', dollar: 'USD', dollars: 'USD', euro: 'EUR', euros: 'EUR', pound: 'GBP', pounds: 'GBP', yen: 'JPY', bitcoin: 'BTC', btc: 'BTC' };
const SYMBOLS = { '₹': 'INR', $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
const STOP = new Set(['Next', 'The', 'My', 'A', 'I', 'This', 'That', 'Me', 'Our', 'It']);
const NAMES = { fx: 'Currency Agent', weather: 'Weather Agent', places: 'Local Guide Agent' };

// ── Understanding the user ────────────────────────────────────────────────────
function matchCity(text) {
  const re = /\b(?:in|to|visit(?:ing)?|around|for|at|of)\s+([A-Z][\p{L}'.-]+(?:\s+(?:de\s+)?[A-Z][\p{L}'.-]+)?)/gu;
  for (const m of text.matchAll(re)) {
    const first = m[1].split(/\s/)[0];
    if (STOP.has(first) || /^[A-Z]{3}$/.test(m[1])) continue;
    return m[1];
  }
  return null;
}

function matchMoney(text) {
  const t = text.replace(/(\d),(\d)/g, '$1$2');
  let m = t.match(/([₹$€£¥])\s?(\d+(?:\.\d+)?)\s?(k)?\b/i);
  if (m) return { amount: Number(m[2]) * (m[3] ? 1000 : 1), from: SYMBOLS[m[1]] };
  m = t.match(/(\d+(?:\.\d+)?)\s?(k)?\s?(INR|USD|EUR|GBP|JPY|AUD|CAD|CHF|THB|SGD|CNY|KRW|rupees?|dollars?|euros?|pounds?|yen)\b/i);
  if (m) return { amount: Number(m[1]) * (m[2] ? 1000 : 1), from: m[3].length === 3 ? m[3].toUpperCase() : CCY_WORDS[m[3].toLowerCase()] };
  return null;
}

function matchTo(text) {
  const code = text.match(/\b(?:to|into|in)\s+([A-Z]{3})\b/)?.[1];
  if (code) return code;
  const word = text.match(/\b(?:to|into|in)\s+(euros?|dollars?|yen|pounds?|rupees?|bitcoin|btc)\b/i)?.[1];
  return word ? CCY_WORDS[word.toLowerCase()] : null;
}

function startDate(text) {
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1];
  if (iso) return iso;
  const d = new Date();
  if (/next week/i.test(text)) d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7)); // next Monday
  else if (/tomorrow/i.test(text)) d.setDate(d.getDate() + 1);
  else if (/this weekend|next weekend/i.test(text)) d.setDate(d.getDate() + (((6 - d.getDay()) + 7) % 7 || 7));
  else return null;
  return d.toISOString().slice(0, 10);
}

function intentOf(text) {
  const dm = text.match(/(\d+|one|two|three|four|five|six|seven)[\s-]*(?:day|night)s?\b/i);
  const days = dm ? (NUM[dm[1].toLowerCase()] ?? Number(dm[1])) : /weekend/i.test(text) ? 2 : null;
  const trip = /\b(plan|trip|itinerary|visit|holiday|vacation|getaway|travel|days? in|weekend in)\b/i.test(text);
  const money = matchMoney(text);
  const interests = [];
  if (/histor|castle|church|palace|heritage/i.test(text)) interests.push('history');
  if (/\bart\b|museum|galler|culture/i.test(text)) interests.push('art');
  if (/nature|park|garden|outdoor|beach/i.test(text)) interests.push('nature');
  if (/neighbo|food|market|street life|local life/i.test(text)) interests.push('neighbourhoods');
  return {
    city: matchCity(text), days, start: startDate(text), money, to: matchTo(text), trip, interests,
    wantsWeather: trip || /weather|forecast|rain|temperature|sunny|cold|hot|pack/i.test(text),
    wantsPlaces: trip || /\b(sights?|see|things to do|attractions?|museums?|what to do|explore)\b/i.test(text),
    wantsFx: !!money || /\b(convert|exchange rate)\b/i.test(text),
  };
}

const looksLikeNewRequest = (text) => {
  const i = intentOf(text);
  return text.length > 25 && !!i.city && (i.wantsWeather || i.wantsPlaces || i.wantsFx);
};

// ── Reading the conversation ──────────────────────────────────────────────────
function parseRoster(system) {
  const out = {};
  const blocks = system.split(/\n(?=- id: )/);
  for (const b of blocks) {
    const m = b.match(/^- id: (\S+)\s+\((.+?) v[^,]*, (built-in|external)/m);
    if (m) out[m[1]] = { id: m[1], name: m[2], external: m[3] === 'external', text: b };
  }
  return out;
}

function events(messages) {
  const ev = [];
  for (const m of messages) {
    for (const b of Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }]) {
      if (m.role === 'user' && b.type === 'text') ev.push({ type: 'user', text: b.text });
      else if (b.type === 'tool_result') {
        let data;
        try { data = JSON.parse(typeof b.content === 'string' ? b.content : b.content?.[0]?.text ?? ''); } catch { data = { error: String(b.content).slice(0, 300) }; }
        ev.push({ type: 'result', id: b.tool_use_id, data });
      } else if (b.type === 'tool_use') ev.push({ type: 'call', id: b.id, input: b.input });
    }
  }
  // Attach the agent id from the matching call to each result.
  const calls = Object.fromEntries(ev.filter((e) => e.type === 'call').map((e) => [e.id, e.input]));
  for (const e of ev) if (e.type === 'result') e.agent = e.data.agent ?? calls[e.id]?.agent;
  return ev;
}

const waitingIn = (segment) => {
  const latest = new Map();
  for (const e of segment) if (e.type === 'result' && e.data.task_id) latest.set(`${e.agent}:${e.data.task_id}`, e);
  return [...latest.values()].filter((e) => e.data.state === 'TASK_STATE_INPUT_REQUIRED');
};

// ── Responding ────────────────────────────────────────────────────────────────
let callSeq = 0;
const toolUse = (agent, text, taskId) => ({
  type: 'tool_use', id: `toolu_demo_${Date.now().toString(36)}_${++callSeq}`, name: 'send_message',
  input: { agent, text, ...(taskId && { task_id: taskId }) },
});

function reply(body, content) {
  const hasCalls = content.some((b) => b.type === 'tool_use');
  return {
    id: `msg_demo_${Date.now().toString(36)}`, type: 'message', role: 'assistant', model: body.model, content,
    stop_reason: hasCalls ? 'tool_use' : 'end_turn',
    usage: { input_tokens: estimateTokens(body.system) + estimateTokens(body.tools) + estimateTokens(body.messages), output_tokens: estimateTokens(content) },
  };
}

export function scriptedResponse(body) {
  const ids = body.tools?.[0]?.input_schema?.properties?.agent?.enum ?? [];
  const roster = parseRoster(body.system ?? '');
  const name = (id) => roster[id]?.name ?? NAMES[id] ?? id;
  const ev = events(body.messages);
  const userIdx = ev.map((e, i) => (e.type === 'user' ? i : -1)).filter((i) => i >= 0);
  const L = userIdx.at(-1);
  const text = ev[L].text;
  const run = ev.slice(L + 1);

  // Which user turn started this piece of work? (Answers to an agent's question don't.)
  let origin = userIdx[0];
  for (let k = 0; k < userIdx.length; k++) {
    const prev = k ? ev.slice(userIdx[k - 1] + 1, userIdx[k]) : [];
    const resumes = waitingIn(prev).length && !looksLikeNewRequest(ev[userIdx[k]].text);
    if (!resumes) origin = userIdx[k];
  }
  const resuming = origin !== L;

  // 1. First call of this turn.
  if (!run.length) {
    if (resuming) {
      const prev = ev.slice(userIdx.at(-2) + 1, L);
      const waiting = waitingIn(prev).filter((w) => ids.includes(w.agent));
      if (waiting.length) {
        return reply(body, [
          { type: 'text', text: `Passing your answer to the ${waiting.map((w) => name(w.agent)).join(' and ')}, on the same task so it can carry on.` },
          ...waiting.map((w) => toolUse(w.agent, text, w.data.task_id)),
        ]);
      }
    }
    return reply(body, plan(text, ids, roster, name));
  }

  // 2. Results are in. Is anyone waiting for the user?
  const waiting = waitingIn(run);
  if (waiting.length) {
    const w = waiting[0];
    const done = [...new Set(run.filter((e) => e.type === 'result' && e.data.state === 'TASK_STATE_COMPLETED').map((e) => name(e.agent)))];
    return reply(body, [{
      type: 'text',
      text: `The **${name(w.agent)}** needs one more detail before it can finish:\n\n> ${w.data.agent_says}\n\nJust reply here. I’ll send your answer back to the same task (\`${w.data.task_id.slice(0, 8)}…\`), so it picks up where it stopped.${done.length ? `\n\nMeanwhile the ${done.join(' and ')} ${done.length > 1 ? 'have' : 'has'} already finished.` : ''}`,
    }]);
  }

  // 3. Everything is back: combine.
  return reply(body, [{ type: 'text', text: compose(intentOf(ev[origin].text), ev.slice(origin + 1), ids, roster, name) }]);
}

function plan(text, ids, roster, name) {
  const i = intentOf(text);
  const calls = [];
  const notes = [];
  const days = i.days ?? 3;

  if (/\b(which|what|supported|list( of)?) currencies\b/i.test(text) && ids.includes('fx')) {
    return [{ type: 'text', text: 'I’ll ask the Currency Agent what it supports.' }, toolUse('fx', 'help')];
  }
  if (i.wantsFx) {
    const to = i.to ?? (i.city ? CITY_CCY[i.city.toLowerCase()] : null);
    if (!ids.includes('fx')) notes.push('No currency agent is connected, so I can’t convert the budget.');
    else if (i.money && to) calls.push(toolUse('fx', `Convert ${i.money.amount} ${i.money.from} to ${to}`));
    else if (i.money && i.trip) notes.push(`I’m not sure which currency ${i.city ?? 'your destination'} uses, so I skipped the conversion. Say e.g. “budget in EUR”.`);
    else if (i.money) calls.push(toolUse('fx', `Convert ${i.money.amount} ${i.money.from}`));
  }
  if (i.wantsWeather) {
    if (!ids.includes('weather')) notes.push('No weather agent is connected, so I can’t check the forecast.');
    else calls.push(toolUse('weather', i.city ? `Daily forecast for ${i.city}, ${days} days${i.start ? ` starting ${i.start}` : ''}` : `Daily forecast, ${days} days`));
  }
  if (i.wantsPlaces) {
    if (!ids.includes('places')) notes.push('No local-guide agent is connected, so I can’t suggest sights.');
    else if (i.city) calls.push(toolUse('places', `Top sights in ${i.city}${i.interests.length ? ` for ${i.interests.join(' and ')}` : ''} (${days}-day trip)`));
  }
  // Agents the visitor added: use them when the request mentions what they do.
  for (const id of ids.filter((x) => roster[x]?.external)) {
    const r = roster[id];
    const words = (r.text.match(/[A-Za-z]{5,}/g) ?? []).map((w) => w.toLowerCase()).filter((w) => !/agent|skills|external|streams|examples|their|which|about|built/.test(w));
    const mentioned = text.toLowerCase().includes(r.name.toLowerCase()) || words.some((w) => text.toLowerCase().includes(w));
    if (mentioned) calls.push(toolUse(id, text));
    else if (i.trip && i.city && /phrase|language|translat/i.test(r.text)) calls.push(toolUse(id, `Useful phrases for a trip to ${i.city}`));
  }

  if (!calls.length) {
    const list = ids.map((id) => `- **${name(id)}**: ${(roster[id]?.text.split('\n')[1] ?? '').trim()}`).join('\n');
    return [{
      type: 'text',
      text: `${notes.length ? `${notes.join(' ')}\n\n` : ''}I’m a host agent: I don’t know facts myself, I delegate to remote agents over A2A. ${ids.length ? `Connected right now:\n\n${list}\n\nTry “Plan 3 days in Lisbon next week. My budget is ₹75,000.”` : 'No agents are connected. Turn some on in the agents bar above the chat.'}`,
    }];
  }
  const who = [...new Set(calls.map((c) => name(c.input.agent)))];
  const lead = who.length > 1 ? `I’ll ask ${who.length} agents at once (${who.join(', ')}). They work in parallel.` : `I’ll ask the ${who[0]}.`;
  return [{ type: 'text', text: [lead, ...notes].join(' ') }, ...calls];
}

// ── Combining results into an answer ─────────────────────────────────────────
const RAINY = /rain|drizzle|storm|shower|snow/i;
const WX_ICON = (c) => (/thunder/i.test(c) ? '⛈️' : /snow/i.test(c) ? '🌨️' : RAINY.test(c) ? '🌧️' : /fog/i.test(c) ? '🌫️' : /overcast/i.test(c) ? '☁️' : /partly/i.test(c) ? '⛅' : '☀️');
const dayLabel = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' });
const fmt = (n, c) => `${Number(n).toLocaleString('en', { maximumFractionDigits: n >= 100 ? 0 : 2 })} ${c}`;

function compose(intent, segment, ids, roster, name) {
  const latest = {};
  for (const e of segment) if (e.type === 'result' && e.agent) latest[e.agent] = e.data;
  const dataOf = (r, n) => r?.artifacts?.find((a) => a.name === n)?.data ?? null;
  const fx = latest.fx;
  const wx = dataOf(latest.weather, 'forecast');
  const sights = dataOf(latest.places, 'sights');
  const conv = dataOf(fx, 'conversion');
  const out = [];
  const city = wx?.city ?? sights?.city ?? intent.city;

  if (wx && sights) {
    const n = wx.days.length;
    out.push(`## ${n} day${n > 1 ? 's' : ''} in ${city}`);
    if (conv) out.push(`**Budget:** ${fmt(conv.amount, conv.from)} ≈ **${fmt(conv.converted, conv.to)}** at today’s ECB rate (${conv.rate}). That is about **${fmt(conv.converted / n, conv.to)} a day**.`);
    const indoor = sights.sights.filter((s) => s.category === 'art');
    const outdoor = sights.sights.filter((s) => s.category !== 'art');
    const per = Math.max(1, Math.min(3, Math.ceil(sights.sights.length / n)));
    const rows = wx.days.map((d) => {
      const wet = RAINY.test(d.conditions) || (d.rainChance ?? 0) >= 50;
      const pick = [];
      const a = wet ? indoor : outdoor;
      const b = wet ? outdoor : indoor;
      while (pick.length < per && (a.length || b.length)) pick.push((a.length ? a : b).shift());
      return { d, wet, pick };
    });
    out.push('| Day | Weather | What to see |\n|---|---|---|\n' + rows.map(({ d, pick }) => `| ${dayLabel(d.date)} | ${WX_ICON(d.conditions)} ${d.conditions}, ${d.low}–${d.high}°C${d.rainChance != null ? `, ${d.rainChance}% rain` : ''} | ${pick.map((s) => `[${s.title}](${s.url})`).join(' · ') || 'Free day: wander'} |`).join('\n'));
    if (rows.some((r) => r.wet) && indoor.length) out.push('Rainy days get the museums and galleries; dry days get the outdoor sights.');
  } else if (wx) {
    out.push(`## Weather in ${wx.city}${wx.country ? `, ${wx.country}` : ''}`);
    out.push('| Day | Conditions | Temp | Rain |\n|---|---|---|---|\n' + wx.days.map((d) => `| ${dayLabel(d.date)} | ${WX_ICON(d.conditions)} ${d.conditions} | ${d.low}–${d.high}°C | ${d.rainChance ?? '–'}% |`).join('\n'));
  } else if (sights) {
    out.push(`## Sights in ${sights.city}`);
    out.push(sights.sights.map((s) => `- [${s.title}](${s.url}): ${s.description || s.category}`).join('\n'));
  }
  if (conv && !(wx && sights)) out.push(`**${fmt(conv.amount, conv.from)} = ${fmt(conv.converted, conv.to)}** at the ECB rate of ${conv.rate} (${conv.date}).`);
  if (fx?.reply) out.push(fx.reply);

  // Agents the visitor added.
  for (const [id, r] of Object.entries(latest)) {
    if (!roster[id]?.external) continue;
    const body = r.reply ?? r.artifacts?.map((a) => a.text).filter(Boolean).join('\n\n') ?? r.agent_says;
    if (body && !r.error) out.push(`### From ${name(id)}\n${body}`);
  }

  // What went wrong, said plainly.
  for (const [id, r] of Object.entries(latest)) {
    if (r.error) out.push(`> **${name(id)}** couldn’t be reached: ${r.error}`);
    else if (r.state === 'TASK_STATE_FAILED') out.push(`> **${name(id)}** tried but failed: ${r.agent_says ?? 'no reason given'} (task state \`FAILED\`)`);
    else if (r.state === 'TASK_STATE_REJECTED') out.push(`> **${name(id)}** turned the request down: ${r.agent_says ?? 'no reason given'} (task state \`REJECTED\`)`);
  }
  if (!out.length) out.push('The agents didn’t return anything I can use.');

  const credits = Object.entries(latest).map(([id, r]) => `${name(id)} (${r.error ? 'unreachable' : r.reply ? 'direct reply' : (r.state ?? '').replace('TASK_STATE_', '').toLowerCase()})`);
  if (credits.length) out.push(`<sub>Delegated over A2A to: ${credits.join(', ')}.</sub>`);
  return out.join('\n\n');
}

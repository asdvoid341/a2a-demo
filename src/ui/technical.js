import { $, esc, pretty, fmtMs, download } from './util.js';
import { icon, stateInfo, TERMINAL } from './icons.js';
import { CONCEPTS } from './concepts.js';
import { sourceUrl } from '../config.js';

/**
 * The Technical view: every HTTP exchange on the wire, the raw Agent Cards,
 * the tasks as the client assembled them (with GetTask / CancelTask buttons),
 * the host model's request, and concept notes with links into the code.
 */
export function createTechnical({ bus, registry, client }) {
  const panels = { wire: $('#tab-wire'), cards: $('#tab-cards'), tasks: $('#tab-tasks'), host: $('#tab-host'), concepts: $('#tab-concepts') };
  let active = 'wire';

  document.querySelectorAll('#tech-view .tabs [role="tab"]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  function show(tab) {
    active = tab;
    document.querySelectorAll('#tech-view .tabs [role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    for (const [k, p] of Object.entries(panels)) p.hidden = k !== tab;
    if (tab === 'cards') renderCards();
    if (tab === 'tasks') renderTasks();
  }

  // ── Wire ──────────────────────────────────────────────────────────────────
  const wire = new Map(); // wid → { req, res, events: [], el }
  panels.wire.innerHTML = '<p class="empty muted">Every HTTP request between the page and the agents appears here: card fetches, JSON-RPC calls and each streamed event. Click one to see the exact JSON.</p><div class="wire-list"></div>';
  const list = panels.wire.querySelector('.wire-list');

  function wireRow(w) {
    const r = w.req;
    const res = w.res;
    const status = res?.error ? `<span class="st err">blocked</span>` : res ? `<span class="st ${res.status < 300 ? 'ok' : 'err'}">${res.status}</span>` : '<span class="st pending">…</span>';
    const rpcErr = res?.body?.error ? `<span class="st err">${esc(res.body.error.code)}</span>` : '';
    const evs = w.events.length ? `<span class="muted">${w.events.length} event${w.events.length > 1 ? 's' : ''}</span>` : '';
    const ms = w.end?.ms ?? res?.ms;
    return `
      <summary>
        <span class="verb">${esc(r.httpMethod)}</span>
        <span class="who">${esc(r.agentName ?? r.agentId ?? '')}</span>
        <span class="what">${esc(r.label)}</span>
        ${r.proxied ? '<span class="tag">via proxy</span>' : ''}
        <span class="spacer"></span>${evs}${rpcErr}${status}<span class="muted ms">${fmtMs(ms)}</span>
      </summary>
      <div class="wire-body">
        <h5>Request</h5>
        <pre class="code">${esc(`${r.httpMethod} ${r.url}`)}\n${esc(Object.entries(r.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n'))}${r.body ? `\n\n${esc(pretty(r.body))}` : ''}</pre>
        ${res ? `<h5>Response ${res.contentType ? `<span class="muted">${esc(res.contentType)}</span>` : ''}</h5>` : ''}
        ${res?.error ? `<p class="callout err">${esc(res.error)}</p>` : ''}
        ${res && res.body !== undefined ? `<pre class="code">${esc(pretty(res.body))}</pre>` : ''}
        ${w.events.map((e) => `<div class="sse"><span class="sse-n">event ${e.n}${e.kind ? ` · <b>${esc(e.kind)}</b>` : ''}${e.ms != null ? ` · +${fmtMs(e.ms)}` : ''}</span><pre class="code">data: ${esc(JSON.stringify(e.frame, null, 2))}</pre></div>`).join('')}
      </div>`;
  }
  function refreshWire(wid) {
    const w = wire.get(wid);
    if (!w) return;
    const open = w.el.open;
    w.el.innerHTML = wireRow(w);
    w.el.open = open;
  }

  // ── Host model ────────────────────────────────────────────────────────────
  let lastPrompt = null;
  const modelLog = [];
  function renderHost() {
    if (!lastPrompt) {
      panels.host.innerHTML = '<p class="empty muted">The host agent is a normal LLM agent loop. Ask something to see the prompt it builds from the Agent Cards, the one tool it has, and every model call.</p>';
      return;
    }
    panels.host.innerHTML = `
      <p class="muted">The roster below is generated from the Agent Cards on every question. Change the agents (add, turn off) and it changes. <a href="${sourceUrl('src/host/prompt.js')}" target="_blank" rel="noopener">prompt.js ↗</a></p>
      ${lastPrompt.sections.map((s) => `<details class="sec" ${s.title.startsWith('Remote') ? 'open' : ''}><summary>${esc(s.title)}</summary><pre class="code wrap">${esc(s.text)}</pre></details>`).join('')}
      <details class="sec"><summary>Tool: send_message</summary><pre class="code">${esc(pretty(lastPrompt.tools))}</pre></details>
      <h4 class="mini-h">Model calls</h4>
      ${modelLog.map((m) => `<details class="sec"><summary>#${m.iteration} ${m.res ? `· ${m.res.stopReason} · ${m.res.usage.input + m.res.usage.output} tokens · ${fmtMs(m.res.ms)}` : '· waiting…'}</summary>
        <h5>Request <span class="muted">${esc(m.req.url)}</span></h5><pre class="code">${esc(pretty(m.req.body))}</pre>
        ${m.res ? `<h5>Response</h5><pre class="code">${esc(pretty(m.res.raw))}</pre>` : ''}</details>`).join('')}`;
  }

  // ── Cards ─────────────────────────────────────────────────────────────────
  let cardSel = null;
  function renderCards() {
    const agents = registry.all();
    if (!cardSel || !registry.get(cardSel)) cardSel = agents[0]?.id;
    const a = registry.get(cardSel);
    panels.cards.innerHTML = `
      <div class="pick">${agents.map((x) => `<button class="pick-btn" data-id="${esc(x.id)}" aria-pressed="${x.id === cardSel}">${icon(x.icon, 13)}${esc(x.card?.name ?? x.id)}</button>`).join('')}</div>
      ${a ? `
        <p class="muted small">Fetched from <a href="${esc(a.cardUrl)}" target="_blank" rel="noopener">${esc(a.cardUrl)}</a></p>
        <div class="anno">
          <div><b>supportedInterfaces</b> where and how to call it (URL, binding, protocol version).</div>
          <div><b>capabilities</b> optional features, e.g. <code>streaming</code>.</div>
          <div><b>skills</b> what it can do, for a host to match against. Free text, so models can read it.</div>
          <div><b>securitySchemes</b> how to authenticate, if needed (OAuth, API key…).</div>
        </div>
        ${a.card ? `${a.card.warnings.map((w) => `<p class="callout warn">${icon('alert')} ${esc(w)}</p>`).join('')}<pre class="code">${esc(pretty(a.card.raw))}</pre>` : `<p class="callout err">${esc(a.error ?? 'Not loaded')}</p>`}` : ''}`;
  }
  panels.cards.addEventListener('click', (e) => {
    const b = e.target.closest('.pick-btn');
    if (b) { cardSel = b.dataset.id; renderCards(); }
  });

  // ── Tasks ─────────────────────────────────────────────────────────────────
  function renderTasks() {
    const items = [...client.tasks.entries()].reverse();
    if (!items.length) {
      panels.tasks.innerHTML = '<p class="empty muted">Tasks appear here as the client assembles them from responses and stream events. You can re-fetch one with <code>GetTask</code> or stop an unfinished one with <code>CancelTask</code>.</p>';
      return;
    }
    panels.tasks.innerHTML = items.map(([key, t]) => {
      const [agentId] = key.split(':');
      const a = registry.get(agentId);
      const info = stateInfo(t.status?.state);
      const canCancel = !TERMINAL.includes(t.status?.state);
      return `
        <details class="task-item" data-key="${esc(key)}">
          <summary>${icon(a?.icon ?? 'agent', 13)} <b>${esc(a?.card?.name ?? agentId)}</b> <code>${esc(t.id.slice(0, 8))}</code> <span class="spacer"></span><span class="state-badge" data-tone="${info.tone}">${esc(info.short)}</span></summary>
          <dl class="facts">
            <dt>id</dt><dd><code>${esc(t.id)}</code></dd>
            <dt>contextId</dt><dd><code>${esc(t.contextId ?? '–')}</code> <span class="muted small">groups related tasks in one conversation</span></dd>
            <dt>history</dt><dd>${t.history?.length ?? 0} messages</dd>
            <dt>artifacts</dt><dd>${(t.artifacts ?? []).map((x) => esc(x.name ?? x.artifactId)).join(', ') || '–'}</dd>
          </dl>
          <div class="task-actions">
            <button class="btn small" data-act="get" ${a ? '' : 'disabled'}>${icon('refresh', 13)}GetTask</button>
            <button class="btn small" data-act="cancel" ${a && canCancel ? '' : 'disabled'} title="${canCancel ? '' : 'Finished tasks can’t be canceled'}">${icon('stop', 13)}CancelTask</button>
          </div>
          <pre class="code">${esc(pretty(t))}</pre>
        </details>`;
    }).join('');
  }
  panels.tasks.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const key = e.target.closest('.task-item').dataset.key;
    const [agentId, ...rest] = key.split(':');
    const taskId = rest.join(':');
    const agent = registry.get(agentId);
    try {
      if (act === 'get') await client.getTask(agent, taskId);
      if (act === 'cancel') await client.cancelTask(agent, taskId);
    } catch (err) {
      alert(err.message);
    }
    renderTasks();
    panels.tasks.querySelector(`[data-key="${CSS.escape(key)}"]`)?.setAttribute('open', '');
  });

  // ── Concepts ──────────────────────────────────────────────────────────────
  panels.concepts.innerHTML = CONCEPTS.map((c) => `
    <article class="concept">
      <h4>${icon(c.icon, 15)} ${esc(c.title)}</h4>
      <p>${c.body}</p>
      ${c.code ? `<p class="small">In the code: ${c.code.map(([label, path]) => `<a href="${sourceUrl(path)}" target="_blank" rel="noopener">${esc(label)}</a>`).join(' · ')}</p>` : ''}
    </article>`).join('');

  // ── Events ────────────────────────────────────────────────────────────────
  let tasksDirty = false;
  bus.on(({ type, data }) => {
    switch (type) {
      case 'wire:request': {
        panels.wire.querySelector('.empty')?.remove();
        const el = document.createElement('details');
        el.className = 'wire-item';
        const w = { req: data, res: null, events: [], el };
        wire.set(data.wid, w);
        el.innerHTML = wireRow(w);
        list.prepend(el);
        break;
      }
      case 'wire:response': { const w = wire.get(data.wid); if (w) { w.res = data; refreshWire(data.wid); } break; }
      case 'wire:event': { const w = wire.get(data.wid); if (w) { w.events.push(data); refreshWire(data.wid); } break; }
      case 'wire:end': { const w = wire.get(data.wid); if (w) { w.end = data; refreshWire(data.wid); } break; }
      case 'host:prompt': lastPrompt = data; renderHost(); break;
      case 'host:model:request': modelLog.unshift({ iteration: data.iteration, req: data }); renderHost(); break;
      case 'host:model:response': { const m = modelLog.find((x) => x.iteration === data.iteration && !x.res); if (m) m.res = data; renderHost(); break; }
      case 'host:session': modelLog.length = 0; renderHost(); break;
      case 'task:update':
        if (active === 'tasks' && !tasksDirty) {
          tasksDirty = true;
          setTimeout(() => { tasksDirty = false; const open = [...panels.tasks.querySelectorAll('details[open]')].map((d) => d.dataset.key); renderTasks(); open.forEach((k) => panels.tasks.querySelector(`[data-key="${CSS.escape(k)}"]`)?.setAttribute('open', '')); }, 300);
        }
        break;
      case 'registry:change': if (active === 'cards') renderCards(); break;
    }
  });

  $('#export-trace').addEventListener('click', () => download(`a2a-trace-${new Date().toISOString().slice(0, 19)}.json`, JSON.stringify(bus.log, null, 2)));
  renderHost();
  return { show };
}


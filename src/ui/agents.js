import { $, esc } from './util.js';
import { icon } from './icons.js';

/**
 * The agent directory UI: chips above the chat, the "Add agent" flow
 * (fetch card → review → add) and the per-agent details dialog.
 */
export function createAgentsUI({ registry, bus, settings, openSettings }) {
  const chips = $('#agent-chips');
  const addDialog = $('#add-dialog');
  const detailDialog = $('#agent-dialog');
  const busy = new Map(); // agentId → task state, for the chip's live dot

  function renderChips() {
    chips.innerHTML = registry.all().map((a) => {
      const name = a.card?.name ?? (a.status === 'loading' ? 'Loading…' : a.id);
      const st = !a.enabled ? 'off' : a.status === 'error' ? 'error' : a.status === 'loading' ? 'loading' : busy.get(a.id) ?? 'ready';
      const title = !a.enabled ? 'Turned off: the host will not see this agent' : a.error ?? `${name}: click for its Agent Card`;
      return `<button class="agent-chip" data-id="${esc(a.id)}" data-state="${st}" data-kind="${a.kind}" title="${esc(title)}">
        ${icon(a.icon, 14)}<span class="agent-chip-name">${esc(name)}</span>${a.kind === 'external' ? '<span class="tag">external</span>' : ''}<span class="dot"></span>
      </button>`;
    }).join('');
  }

  chips.addEventListener('click', (e) => {
    const id = e.target.closest('.agent-chip')?.dataset.id;
    if (id) openDetail(id);
  });

  bus.on((evt) => {
    if (evt.type === 'registry:change') {
      renderChips();
      if (detailDialog.open) openDetail(detailDialog.dataset.id, true);
    }
    if (evt.type === 'task:update') {
      const s = evt.data.state;
      busy.set(evt.data.agentId, s === 'TASK_STATE_WORKING' || s === 'TASK_STATE_SUBMITTED' ? 'working' : s === 'TASK_STATE_INPUT_REQUIRED' ? 'waiting' : 'ready');
      renderChips();
    }
    if (evt.type === 'host:session') { busy.clear(); renderChips(); }
  });

  // ── Details ───────────────────────────────────────────────────────────────
  function openDetail(id, refresh = false) {
    const a = registry.get(id);
    if (!a) { detailDialog.close(); return; }
    const c = a.card;
    detailDialog.dataset.id = id;
    $('#agent-detail').innerHTML = `
      <header class="detail-head">
        <span class="detail-icon">${icon(a.icon, 22)}</span>
        <div>
          <h3>${esc(c?.name ?? a.id)}</h3>
          <p class="muted small">${a.kind === 'builtin' ? 'Built-in agent, hosted by this page’s Service Worker' : `External agent at ${esc(safeHost(c?.rpcUrl ?? a.cardUrl))}`}</p>
        </div>
        <span class="spacer"></span>
        <button class="btn ghost small" data-act="close" aria-label="Close">${icon('x')}</button>
      </header>
      ${a.error ? `<p class="callout err">${icon('xCircle')} ${esc(a.error)}</p>` : ''}
      ${c ? cardSummary(c) : '<p class="muted">The card hasn’t loaded.</p>'}
      <div class="detail-actions">
        <label class="switch"><input type="checkbox" data-act="enabled" ${a.enabled ? 'checked' : ''}><span class="track"></span>Host can use this agent</label>
        ${a.kind === 'external' ? `<label class="check"><input type="checkbox" data-act="proxy" ${a.useProxy ? 'checked' : ''}> Use CORS proxy</label>` : ''}
        <span class="spacer"></span>
        <a class="btn small ghost" href="${esc(a.cardUrl)}" target="_blank" rel="noopener" title="Open the raw Agent Card">${icon('external')}Card JSON</a>
        <button class="btn small ghost" data-act="reload">${icon('refresh')}Reload card</button>
        ${a.kind === 'external' ? `<button class="btn small ghost danger-text" data-act="remove">${icon('trash')}Remove</button>` : ''}
      </div>`;
    if (!refresh) detailDialog.showModal();
  }

  detailDialog.addEventListener('click', (e) => {
    if (e.target === detailDialog) return detailDialog.close();
    const act = e.target.closest('[data-act]')?.dataset.act;
    const id = detailDialog.dataset.id;
    if (act === 'close') detailDialog.close();
    if (act === 'reload') registry.load(registry.get(id));
    if (act === 'remove' && confirm('Remove this agent?')) { registry.remove(id); detailDialog.close(); }
  });
  detailDialog.addEventListener('change', (e) => {
    const act = e.target.dataset.act;
    const id = detailDialog.dataset.id;
    if (act === 'enabled') registry.setEnabled(id, e.target.checked);
    if (act === 'proxy') {
      if (e.target.checked && !settings.getProxy()) {
        e.target.checked = false;
        detailDialog.close();
        openSettings('Set your CORS proxy URL first. See proxy/ in the repo for a one-command Cloudflare Worker.', 'proxy');
        return;
      }
      registry.setProxy(id, e.target.checked);
    }
  });

  // ── Add agent ─────────────────────────────────────────────────────────────
  const url = $('#add-url');
  const proxy = $('#add-proxy');
  const preview = $('#add-preview');
  const error = $('#add-error');
  const confirmBtn = $('#add-confirm');
  const fetchBtn = $('#add-fetch');
  let pending = null;

  $('#add-agent').addEventListener('click', () => {
    pending = null;
    preview.hidden = true;
    error.textContent = '';
    confirmBtn.disabled = true;
    const hasProxy = !!settings.getProxy();
    proxy.disabled = !hasProxy;
    if (!hasProxy) proxy.checked = false;
    $('#add-proxy-hint').innerHTML = hasProxy ? `via ${esc(safeHost(settings.getProxy()))}` : 'No proxy set. <a href="#" data-act="set-proxy">Set one</a>';
    addDialog.showModal();
    url.focus();
  });
  $('#add-proxy-hint').addEventListener('click', (e) => {
    if (e.target.dataset.act !== 'set-proxy') return;
    e.preventDefault();
    addDialog.close();
    openSettings('Paste the URL of your CORS proxy (see proxy/ in the repo).', 'proxy');
  });

  async function fetchCard() {
    error.textContent = '';
    preview.hidden = true;
    confirmBtn.disabled = true;
    pending = null;
    let input = url.value.trim();
    if (!input) { error.textContent = 'Paste a URL first.'; return; }
    if (!/^https?:\/\//i.test(input)) input = `https://${input}`;
    try { new URL(input); } catch { error.textContent = 'That is not a valid URL.'; return; }
    fetchBtn.disabled = true;
    fetchBtn.textContent = 'Fetching…';
    try {
      const card = await registry.preview(input, { useProxy: proxy.checked });
      pending = { cardUrl: card.cardUrl, card, useProxy: proxy.checked };
      preview.innerHTML = `${card.errors.map((m) => `<p class="callout err">${icon('xCircle')} ${esc(m)}</p>`).join('')}${cardSummary(card)}`;
      preview.hidden = false;
      confirmBtn.disabled = card.errors.length > 0;
    } catch (err) {
      error.textContent = err.message;
    } finally {
      fetchBtn.disabled = false;
      fetchBtn.textContent = 'Fetch card';
    }
  }
  fetchBtn.addEventListener('click', fetchCard);
  url.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); fetchCard(); }
  });
  $('#add-form').addEventListener('submit', (e) => {
    if (e.submitter?.value !== 'add') return;
    if (!pending) { e.preventDefault(); return; }
    registry.addExternal(pending);
    bus.emit('registry:added', { name: pending.card.name });
  });

  renderChips();
  return { openDetail };
}

const safeHost = (u) => { try { return new URL(u).host; } catch { return u ?? ''; } };

/** A readable summary of a normalized card, with the warnings a careful client raises. */
export function cardSummary(c) {
  const facts = [
    ['Protocol', `A2A ${esc(c.protocolVersion)} · ${esc(c.binding ?? 'no JSON-RPC')}`],
    ['Endpoint', c.rpcUrl ? `<code>${esc(c.rpcUrl)}</code>` : '–'],
    ['Streaming', c.streaming ? 'Yes (SendStreamingMessage, SSE)' : 'No (SendMessage only)'],
    ['Version', esc(c.version)],
    ...(c.provider ? [['Provider', esc(c.provider)]] : []),
    ['Auth', c.needsAuth ? `${icon('lock', 13)} ${esc(c.securitySchemes.join(', '))}` : 'None required'],
  ];
  return `
    <p class="card-desc">${esc(c.description)}</p>
    <dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    <h4 class="mini-h">Skills (${c.skills.length})</h4>
    <ul class="skills">${c.skills.map((s) => `
      <li><b>${esc(s.name)}</b> <span class="muted">${esc(s.description)}</span>
        ${s.tags.length ? `<div class="tags">${s.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
        ${s.examples.length ? `<div class="examples">e.g. ${s.examples.slice(0, 2).map((x) => `<code>${esc(x)}</code>`).join(' ')}</div>` : ''}
      </li>`).join('') || '<li class="muted">None listed</li>'}</ul>
    ${c.warnings.length ? `<h4 class="mini-h">Things to know</h4>${c.warnings.map((w) => `<p class="callout warn">${icon('alert')} ${esc(w)}</p>`).join('')}` : ''}`;
}

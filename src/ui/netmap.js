import { esc, shorten } from './util.js';
import { iconPaths, stateInfo } from './icons.js';

/**
 * "Who is talking to whom": the user, the host agent and every remote agent,
 * with each real HTTP exchange animated along the edges. Requests travel out
 * (solid), stream events and responses travel back, card fetches are dashed.
 */
const W = 640;
const ROW = 60;
const NODE_W = 210;
const AX = W - NODE_W - 12;
const HX = 150;
const HW = 150;

export function createNetMap({ el, legendEl, bus, registry }) {
  const nodeState = new Map(); // agentId → { tone, label }
  let hostLabel = 'Idle';
  let hostModel = '';
  let geo = null;

  legendEl.innerHTML = `
    <span><i class="lg lg-req"></i>Request</span>
    <span><i class="lg lg-evt"></i>Streamed event / response</span>
    <span><i class="lg lg-card"></i>Agent Card fetch</span>`;

  function render() {
    const agents = registry.all();
    const n = Math.max(agents.length, 1);
    const H = Math.max(200, n * ROW + 24);
    const cy = H / 2;
    const top = (H - n * ROW) / 2 + ROW / 2;
    geo = { H, cy, ys: Object.fromEntries(agents.map((a, i) => [a.id, top + i * ROW])) };

    const edges = agents.map((a) => {
      const y = geo.ys[a.id];
      return `<path class="edge${a.enabled ? '' : ' off'}" id="edge-${esc(a.id)}" d="M ${HX + HW} ${cy} C ${HX + HW + 70} ${cy}, ${AX - 70} ${y}, ${AX} ${y}"/>`;
    }).join('');

    const nodes = agents.map((a) => {
      const y = geo.ys[a.id];
      const st = nodeState.get(a.id);
      const tone = !a.enabled ? 'off' : a.status === 'error' ? 'err' : a.status === 'loading' ? 'loading' : st?.tone ?? 'idle';
      const label = !a.enabled ? 'Turned off' : a.status === 'error' ? 'Card error' : a.status === 'loading' ? 'Reading card…' : st?.label ?? 'Ready';
      const sub = a.kind === 'builtin' ? 'built-in · this site' : `external · ${safeHost(a.card?.rpcUrl ?? a.cardUrl)}`;
      return `
        <g class="node agent" data-id="${esc(a.id)}" data-tone="${tone}" transform="translate(${AX} ${y - 23})" tabindex="0" role="button" aria-label="${esc(a.card?.name ?? a.id)}: ${esc(label)}">
          <rect width="${NODE_W}" height="46" rx="11"/>
          <g transform="translate(10 11) scale(1)" class="nicon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconPaths(a.icon)}</svg></g>
          <text x="42" y="19" class="n-title">${esc(shorten(a.card?.name ?? a.id, 20))}</text>
          <text x="42" y="35" class="n-sub">${esc(shorten(sub, 26))}</text>
          <g class="pill" transform="translate(${NODE_W - 8} 23)"><text text-anchor="end" class="n-state" dy="4">${esc(label)}</text></g>
        </g>`;
    }).join('');

    el.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" class="map-svg" role="img" aria-label="Live map of the host agent and the remote agents it talks to">
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <path class="edge" id="edge-user" d="M 64 ${cy} L ${HX} ${cy}"/>
        ${edges}
        <g class="node user" transform="translate(40 ${cy})"><circle r="22"/><g transform="translate(-12 -12)" class="nicon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconPaths('user')}</svg></g><text y="40" text-anchor="middle" class="n-sub">You</text></g>
        <g class="node host" data-tone="${hostLabel === 'Idle' ? 'idle' : 'active'}" transform="translate(${HX} ${cy - 34})">
          <rect width="${HW}" height="68" rx="13"/>
          <g transform="translate(12 12)" class="nicon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconPaths('host')}</svg></g>
          <text x="44" y="22" class="n-title">Host agent</text>
          <text x="44" y="38" class="n-sub">${esc(shorten(hostModel || 'your chat partner', 17))}</text>
          <text x="12" y="58" class="n-state host-state">${esc(hostLabel)}</text>
        </g>
        ${nodes}
        <g id="packets"></g>
      </svg>`;
  }

  el.addEventListener('click', (e) => {
    const id = e.target.closest('.node.agent')?.dataset.id;
    if (id) bus.emit('ui:open-agent', { id });
  });

  function packet(edgeId, { reverse = false, kind = 'req', label } = {}) {
    const path = el.querySelector(`#edge-${CSS.escape(edgeId)}`);
    const layer = el.querySelector('#packets');
    if (!path || !layer) return;
    const len = path.getTotalLength();
    const ns = 'http://www.w3.org/2000/svg';
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('r', kind === 'evt' ? 4 : 5.5);
    dot.setAttribute('class', `packet p-${kind}`);
    layer.append(dot);
    let tag = null;
    if (label) {
      tag = document.createElementNS(ns, 'text');
      tag.setAttribute('class', `p-label p-${kind}`);
      tag.setAttribute('text-anchor', 'middle');
      tag.textContent = label;
      layer.append(tag);
    }
    const dur = kind === 'evt' ? 520 : 700;
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const p = path.getPointAtLength((reverse ? 1 - e : e) * len);
      dot.setAttribute('cx', p.x);
      dot.setAttribute('cy', p.y);
      if (tag) { tag.setAttribute('x', p.x); tag.setAttribute('y', p.y - 10); }
      if (t < 1) requestAnimationFrame(step);
      else { dot.remove(); setTimeout(() => tag?.remove(), 250); }
    };
    requestAnimationFrame(step);
    // rAF pauses in hidden tabs; make sure nothing is left behind.
    setTimeout(() => { dot.remove(); tag?.remove(); }, dur + 600);
  }

  function setAgent(id, tone, label) {
    nodeState.set(id, { tone, label });
    const g = el.querySelector(`.node.agent[data-id="${CSS.escape(id)}"]`);
    if (!g) return;
    g.dataset.tone = tone;
    g.querySelector('.n-state').textContent = label;
  }
  function setHost(label, model) {
    hostLabel = label;
    if (model !== undefined) hostModel = model;
    const g = el.querySelector('.node.host');
    if (!g) return;
    g.dataset.tone = label === 'Idle' ? 'idle' : 'active';
    g.querySelector('.host-state').textContent = label;
    if (model !== undefined) g.querySelectorAll('.n-sub')[0].textContent = shorten(model, 17);
  }

  const KIND_LABEL = { task: 'task', statusUpdate: 'status', artifactUpdate: 'artifact', message: 'message' };

  bus.on(({ type, data }) => {
    switch (type) {
      case 'registry:change': render(); break;
      case 'wire:request':
        if (!data.agentId || data.agentId === 'preview') break;
        if (data.label === 'Agent Card') packet(data.agentId, { kind: 'card', label: 'GET card' });
        else packet(data.agentId, { kind: 'req', label: data.method });
        break;
      case 'wire:event':
        if (data.agentId) packet(data.agentId, { reverse: true, kind: 'evt', label: KIND_LABEL[data.kind] });
        break;
      case 'wire:response':
        if (data.agentId && data.agentId !== 'preview' && !data.streaming && data.body !== undefined) packet(data.agentId, { reverse: true, kind: 'evt', label: data.error ? 'error' : `${data.status}` });
        if (data.agentId && data.error) setAgent(data.agentId, 'err', 'Unreachable');
        break;
      case 'task:update': {
        const info = stateInfo(data.state);
        const tone = { accent: 'working', warn: 'waiting', ok: 'done', err: 'err', muted: 'idle', neutral: 'working' }[info.tone];
        setAgent(data.agentId, tone, info.short);
        break;
      }
      case 'host:approval': setAgent(data.agentId, 'waiting', 'Needs your OK'); break;
      case 'host:delegate:result': if (!data.ok) setAgent(data.agentId, data.declined ? 'idle' : 'err', data.declined ? 'Not sent' : 'Unreachable'); break;
      case 'host:run:start':
        setHost('Reading cards', data.provider === 'demo' ? 'scripted (demo)' : data.model);
        packet('user', { kind: 'req', label: 'your question' });
        break;
      case 'host:model:request': setHost('Thinking…'); break;
      case 'host:plan': setHost(`Delegating ×${data.calls.length}`); break;
      case 'host:model:response': if (data.stopReason !== 'tool_use') setHost('Writing answer'); break;
      case 'host:run:end':
        setHost('Idle');
        packet('user', { reverse: true, kind: 'evt', label: 'answer' });
        break;
      case 'host:session':
        nodeState.clear();
        render();
        break;
    }
  });

  render();
}

const safeHost = (u) => { try { return new URL(u).host; } catch { return ''; } };

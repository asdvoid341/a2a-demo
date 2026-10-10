import { esc } from './util.js';
import { stateInfo } from './icons.js';

/**
 * The A2A task state machine, with every live task drawn as a token on its
 * current state. Transitions flash as they happen.
 */
const POS = {
  TASK_STATE_SUBMITTED: [78, 72],
  TASK_STATE_WORKING: [250, 72],
  TASK_STATE_INPUT_REQUIRED: [250, 160],
  TASK_STATE_COMPLETED: [500, 24],
  TASK_STATE_FAILED: [500, 70],
  TASK_STATE_REJECTED: [500, 116],
  TASK_STATE_CANCELED: [500, 162],
};
const EDGES = [
  ['TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING', 'M 143 72 L 185 72'],
  ['TASK_STATE_WORKING', 'TASK_STATE_COMPLETED', 'M 315 66 C 370 60, 390 24, 435 24'],
  ['TASK_STATE_WORKING', 'TASK_STATE_FAILED', 'M 315 72 C 370 72, 390 70, 435 70'],
  ['TASK_STATE_WORKING', 'TASK_STATE_REJECTED', 'M 315 78 C 370 84, 390 116, 435 116'],
  ['TASK_STATE_WORKING', 'TASK_STATE_INPUT_REQUIRED', 'M 232 87 L 232 145'],
  ['TASK_STATE_INPUT_REQUIRED', 'TASK_STATE_WORKING', 'M 268 145 L 268 87'],
  ['TASK_STATE_INPUT_REQUIRED', 'TASK_STATE_CANCELED', 'M 315 162 L 435 162'],
  ['TASK_STATE_SUBMITTED', 'TASK_STATE_REJECTED', 'M 110 87 C 140 140, 380 130, 435 118'],
];
const NW = 130;
const NH = 30;

export function createLifecycle({ el, bus, registry }) {
  const tasks = new Map(); // key → { agentId, id, state }
  let last = null;

  el.innerHTML = `
    <svg viewBox="0 0 640 186" class="life-svg" role="img" aria-label="Task state machine">
      <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="arrowhead"/></marker></defs>
      ${EDGES.map(([a, b, d]) => `<path class="l-edge" data-from="${a}" data-to="${b}" d="${d}" marker-end="url(#arr)"/>`).join('')}
      ${Object.entries(POS).map(([s, [x, y]]) => {
        const i = stateInfo(s);
        return `<g class="l-node" data-state="${s}" data-tone="${i.tone}" transform="translate(${x - NW / 2} ${y - NH / 2})"><title>${esc(s)}: ${esc(i.what)}</title><rect width="${NW}" height="${NH}" rx="15"/><text x="${NW / 2}" y="19.5" text-anchor="middle">${esc(i.short)}</text></g>`;
      }).join('')}
      <g id="tokens"></g>
    </svg>
    <p class="life-explain" id="life-explain">Each delegation creates a task on the remote agent. Its state is how the host knows whether to wait, answer a question, or read the result.</p>`;

  const explain = el.querySelector('#life-explain');

  function drawTokens() {
    const layer = el.querySelector('#tokens');
    const byState = {};
    for (const t of tasks.values()) (byState[t.state] ??= []).push(t);
    let html = '';
    for (const [state, list] of Object.entries(byState)) {
      const pos = POS[state];
      if (!pos) continue;
      list.slice(-6).forEach((t, i) => {
        const a = registry.get(t.agentId);
        const name = a?.card?.name ?? t.agentId;
        const x = pos[0] + NW / 2 - 8 - i * 15;
        const y = pos[1] - NH / 2 - 2;
        html += `<g class="token" data-tone="${stateInfo(state).tone}" transform="translate(${x} ${y})"><title>${esc(name)} · task ${esc(t.id.slice(0, 8))}</title><circle r="8"/><text text-anchor="middle" dy="3.5">${esc(name[0] ?? '?')}</text></g>`;
      });
    }
    layer.innerHTML = html;
    el.querySelectorAll('.l-node').forEach((n) => n.classList.toggle('has', !!byState[n.dataset.state]?.length));
  }

  function flash(from, to) {
    const e = el.querySelector(`.l-edge[data-from="${from}"][data-to="${to}"]`);
    if (!e) return;
    e.classList.remove('hot');
    void e.getBoundingClientRect();
    e.classList.add('hot');
    setTimeout(() => e.classList.remove('hot'), 1600);
  }

  bus.on(({ type, data }) => {
    if (type === 'host:session') { tasks.clear(); drawTokens(); return; }
    if (type !== 'task:update') return;
    const key = `${data.agentId}:${data.task.id}`;
    const prev = tasks.get(key)?.state ?? data.prevState;
    const state = data.state;
    tasks.set(key, { agentId: data.agentId, id: data.task.id, state });
    if (prev && prev !== state) {
      flash(prev, state);
      if (prev === 'TASK_STATE_SUBMITTED' && state !== 'TASK_STATE_WORKING') flash('TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING'), flash('TASK_STATE_WORKING', state);
    }
    if (prev !== state) {
      const name = registry.get(data.agentId)?.card?.name ?? data.agentId;
      const i = stateInfo(state);
      last = `<b>${esc(name)}</b> · task <code>${esc(data.task.id.slice(0, 8))}</code>: ${prev ? `${esc(stateInfo(prev).short)} → ` : ''}<b class="tone-${i.tone}">${esc(i.short)}</b>. ${esc(i.what)}`;
      explain.innerHTML = last;
    }
    drawTokens();
  });
}

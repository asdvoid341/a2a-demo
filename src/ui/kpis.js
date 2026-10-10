import { fmtCost, fmtTokens } from './util.js';
import { icon } from './icons.js';

/** Key numbers for the current chat: agents, A2A traffic, tasks, model usage. */
export function createKpis({ el, bus, registry }) {
  let s;
  const reset = () => { s = { calls: 0, events: 0, tasks: new Set(), model: 0, tokens: 0, cost: 0, costKnown: true, ms: 0 }; };
  reset();

  const tile = (ic, label, value, sub, title) => `<div class="kpi" title="${title}"><span class="kpi-ic">${icon(ic, 14)}</span><div><div class="kpi-v">${value}</div><div class="kpi-l">${label}${sub ? ` <span class="muted">${sub}</span>` : ''}</div></div></div>`;
  function render() {
    const all = registry.all();
    const ready = registry.usable().length;
    el.innerHTML = [
      tile('card', 'Agents', `${ready}<small>/${all.length}</small>`, 'usable', 'Agents the host can use: enabled, with a valid card'),
      tile('link', 'A2A requests', s.calls, '', 'JSON-RPC calls and card fetches sent to agents'),
      tile('stream', 'Streamed events', s.events, '', 'Server-Sent Events received from streaming agents'),
      tile('task', 'Tasks', s.tasks.size, '', 'Tasks created on remote agents in this chat'),
      tile('model', 'Host model', `${s.model}<small> calls</small>`, s.tokens ? `${fmtTokens(s.tokens)} tok · ${s.costKnown ? fmtCost(s.cost) : 'n/a'}` : '', 'Calls the host made to its own LLM, with tokens and cost'),
    ].join('');
  }

  bus.on(({ type, data }) => {
    if (type === 'host:session') reset();
    if (type === 'wire:request' && data.agentId !== 'preview') s.calls++;
    if (type === 'wire:event') s.events++;
    if (type === 'task:update') s.tasks.add(`${data.agentId}:${data.task.id}`);
    if (type === 'host:model:response') {
      s.model++;
      s.tokens += data.usage.input + data.usage.output;
      if (data.cost == null) s.costKnown = false;
      else s.cost += data.cost;
    }
    if (['host:session', 'wire:request', 'wire:event', 'task:update', 'host:model:response', 'registry:change'].includes(type)) render();
  });
  render();
}

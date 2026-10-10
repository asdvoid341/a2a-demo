import { $, esc, h, markdown, shorten } from './util.js';
import { icon, stateInfo } from './icons.js';

export const SUGGESTIONS = [
  { text: 'Plan 3 days in Lisbon next week. My budget is ₹75,000.', note: 'Three agents in parallel, one asks you a question' },
  { text: 'What’s the weather in Tokyo for the next 5 days?', note: 'One streaming agent, artifact in chunks' },
  { text: 'Convert 250 USD to JPY', note: 'A plain, non-streaming SendMessage' },
  { text: 'Weather in Hogwarts', note: 'A task that fails' },
  { text: 'Convert 100 EUR to Bitcoin', note: 'A task the agent rejects' },
  { text: 'Which currencies can you convert?', note: 'A direct reply: a Message, no task' },
];

/**
 * The left-hand chat. It renders the conversation from bus events: each host
 * delegation becomes a live card that follows its A2A task (state, status
 * messages, artifact chunks) as the events stream in.
 */
export function createChat({ bus, registry, onSuggest }) {
  const log = $('#chat-log');
  const scroller = $('#chat');
  let turn = null; // current assistant block
  const cards = new Map(); // callId → card element
  const taskToCall = new Map(); // `${agentId}:${taskId}` → callId
  const pendingByAgent = new Map(); // agentId → [callId] awaiting their first task event

  const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 140;
  const scroll = (force) => { if (force || nearBottom()) requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; }); };

  function welcome() {
    log.innerHTML = '';
    log.append(h(`
      <div class="welcome">
        <h2>Plan a trip with a team of agents</h2>
        <p>The <b>host agent</b> you chat with knows nothing about weather, money or places. It finds <b>remote agents</b> through their Agent Cards and delegates work to them over <b>A2A</b>. Watch the right-hand side while it works.</p>
        <div class="suggestions">${SUGGESTIONS.map((s) => `<button class="suggestion" data-text="${esc(s.text)}"><span>${esc(s.text)}</span><small>${esc(s.note)}</small></button>`).join('')}</div>
      </div>`));
  }
  log.addEventListener('click', (e) => {
    const s = e.target.closest('.suggestion');
    if (s) onSuggest(s.dataset.text);
  });

  function newTurn() {
    turn = h(`<div class="msg assistant"><div class="avatar">${icon('host', 16)}</div><div class="bubble"><div class="steps"></div><div class="answer"></div></div></div>`);
    log.append(turn);
    return turn;
  }
  const steps = () => (turn ?? newTurn()).querySelector('.steps');
  const step = (cls, html) => { const el = h(`<div class="step ${cls}">${html}</div>`); steps().append(el); scroll(); return el; };

  function delegationCard({ callId, agentId, agentName, text, taskId, streaming }) {
    const a = registry.get(agentId);
    const el = h(`
      <div class="delegation" data-call="${esc(callId)}" data-state="sending">
        <div class="dl-head">
          <span class="dl-icon">${icon(a?.icon ?? 'agent', 15)}</span>
          <b>${esc(agentName)}</b>
          <span class="dl-method">${streaming ? 'SendStreamingMessage' : 'SendMessage'}${taskId ? ' · same task' : ''}</span>
          <span class="spacer"></span>
          <span class="state-badge" data-tone="neutral">Sending…</span>
        </div>
        <div class="dl-sent">${icon('chat', 13)}<span>“${esc(shorten(text, 160))}”</span></div>
        <div class="dl-status" hidden></div>
        <div class="dl-artifacts" hidden></div>
      </div>`);
    steps().append(el);
    cards.set(callId, el);
    if (taskId) taskToCall.set(`${agentId}:${taskId}`, callId);
    else pendingByAgent.set(agentId, [...(pendingByAgent.get(agentId) ?? []), callId]);
    scroll();
  }

  function cardForTask(agentId, taskId) {
    const key = `${agentId}:${taskId}`;
    if (!taskToCall.has(key)) {
      const q = pendingByAgent.get(agentId);
      if (q?.length) taskToCall.set(key, q.shift());
    }
    return cards.get(taskToCall.get(key));
  }

  function updateCard(el, task) {
    const info = stateInfo(task.status?.state);
    el.dataset.state = info.tone;
    const badge = el.querySelector('.state-badge');
    badge.dataset.tone = info.tone;
    badge.textContent = info.short;
    badge.title = `${task.status?.state}: ${info.what}`;
    const status = (task.status?.message?.parts ?? []).filter((p) => p.text).map((p) => p.text).join(' ');
    const st = el.querySelector('.dl-status');
    if (status) {
      st.hidden = false;
      st.innerHTML = `${icon(task.status.state === 'TASK_STATE_INPUT_REQUIRED' ? 'question' : 'stream', 13)}<span>${esc(status)}</span>`;
    }
    const arts = el.querySelector('.dl-artifacts');
    if (task.artifacts?.length) {
      arts.hidden = false;
      arts.innerHTML = task.artifacts.map((a) => {
        const text = a.parts.filter((p) => p.text != null).map((p) => p.text).join('\n');
        const hasData = a.parts.some((p) => p.data != null);
        return `<details class="artifact"><summary>${icon('artifact', 13)} Artifact <b>${esc(a.name ?? a.artifactId)}</b> <span class="muted">${a.parts.length} part${a.parts.length > 1 ? 's' : ''}${hasData ? ', incl. JSON data' : ''}</span></summary><pre>${esc(shorten(text, 1600))}</pre></details>`;
      }).join('');
    }
    el.querySelector('.dl-task')?.remove();
    el.querySelector('.dl-head .dl-method').insertAdjacentHTML('afterend', `<span class="dl-task" title="Task id ${esc(task.id)}">task ${esc(task.id.slice(0, 8))}</span>`);
    scroll();
  }

  bus.on(({ type, data }) => {
    switch (type) {
      case 'host:run:start':
        log.querySelector('.welcome')?.remove();
        log.append(h(`<div class="msg user"><div class="bubble">${esc(data.userText)}</div></div>`));
        newTurn();
        step('muted', `${icon('card', 13)} Reading agent cards…`);
        scroll(true);
        break;
      case 'host:discover': {
        const s = steps().lastElementChild;
        const names = data.agents.map((a) => a.name).join(', ');
        s.innerHTML = `${icon('card', 13)} Knows <b>${data.agents.length}</b> agent${data.agents.length === 1 ? '' : 's'} from their cards${names ? `: ${esc(names)}` : ''}${data.skipped.length ? ` <span class="muted">(${data.skipped.map((x) => `${esc(x.name)}: ${esc(x.why)}`).join('; ')})</span>` : ''}`;
        break;
      }
      case 'host:thinking':
        step('thought', markdown(data.text));
        break;
      case 'host:delegate':
        delegationCard(data);
        break;
      case 'task:update': {
        const el = cardForTask(data.agentId, data.task.id);
        if (el) updateCard(el, data.task);
        break;
      }
      case 'host:delegate:result': {
        const el = cards.get(data.callId);
        if (!el) break;
        if (!data.ok) {
          el.dataset.state = 'err';
          const badge = el.querySelector('.state-badge');
          badge.dataset.tone = data.declined ? 'muted' : 'err';
          badge.textContent = data.declined ? 'Not sent' : 'Unreachable';
          el.querySelector('.dl-status').hidden = false;
          el.querySelector('.dl-status').innerHTML = `${icon('alert', 13)}<span>${esc(data.error)}</span>`;
        } else if (data.message) {
          el.dataset.state = 'ok';
          const badge = el.querySelector('.state-badge');
          badge.dataset.tone = 'ok';
          badge.textContent = 'Replied (no task)';
          el.querySelector('.dl-status').hidden = false;
          el.querySelector('.dl-status').innerHTML = `${icon('chat', 13)}<span>${esc(data.summary.reply)}</span>`;
        }
        break;
      }
      case 'host:retry':
        step('warn', `${icon('clock', 13)} Model busy, retrying in ${Math.round(data.waitMs / 1000)}s (attempt ${data.attempt})`);
        break;
      case 'host:error':
        step('err', `${icon('xCircle', 13)} ${esc(data.message)}`);
        break;
      case 'host:aborted':
        step('muted', `${icon('stop', 13)} Stopped.`);
        break;
      case 'host:run:end': {
        if (!turn) break;
        if (data.text) turn.querySelector('.answer').innerHTML = markdown(data.text);
        const s = data.stats;
        turn.querySelector('.bubble').append(h(`<div class="turn-meta">${s.delegations} delegation${s.delegations === 1 ? '' : 's'} · ${s.iterations} model call${s.iterations === 1 ? '' : 's'} · ${(s.ms / 1000).toFixed(1)}s</div>`));
        turn = null;
        scroll();
        break;
      }
    }
  });

  /** Ask before sending data to an agent outside this site. Resolves true / false. */
  function askApproval({ agent, text, signal }) {
    return new Promise((resolve) => {
      const host = new URL(agent.card.rpcUrl).host;
      const el = step('approval', `
        <div class="approval-head">${icon('shield', 15)} <b>Share with an external agent?</b></div>
        <p>The host wants to send this to <b>${esc(agent.card.name)}</b> at <code>${esc(host)}</code>, a service outside this site:</p>
        <blockquote>${esc(text)}</blockquote>
        <p class="muted small">Whatever you send becomes that operator’s data. A2A has no built-in rule about this; deciding is the client’s job.</p>
        <div class="approval-actions"><button class="btn small primary" data-a="yes">Send it</button><button class="btn small" data-a="no">Don’t send</button></div>`);
      const done = (ok) => {
        el.querySelector('.approval-actions').innerHTML = `<span class="muted small">${ok ? 'Allowed for this chat.' : 'Declined.'}</span>`;
        resolve(ok);
      };
      el.addEventListener('click', (e) => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (a) done(a === 'yes');
      });
      signal?.addEventListener('abort', () => done(false), { once: true });
      el.querySelector('[data-a="yes"]').focus();
    });
  }

  function reset() {
    cards.clear();
    taskToCall.clear();
    pendingByAgent.clear();
    turn = null;
    welcome();
  }

  welcome();
  return { reset, askApproval, notice: (html) => { log.append(h(`<div class="notice">${html}</div>`)); scroll(true); } };
}

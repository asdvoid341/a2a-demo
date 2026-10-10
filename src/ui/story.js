import { esc, shorten } from './util.js';
import { icon, stateInfo } from './icons.js';

/**
 * "What just happened": the run told in plain English, in four phases
 * (Discover → Delegate → Collaborate → Combine), each step with a "Why?".
 */
const PHASE = {
  discover: { label: 'Discover', icon: 'card' },
  delegate: { label: 'Delegate', icon: 'link' },
  collaborate: { label: 'Collaborate', icon: 'question' },
  result: { label: 'Result', icon: 'artifact' },
  combine: { label: 'Combine', icon: 'host' },
  trust: { label: 'Trust', icon: 'shield' },
  problem: { label: 'Problem', icon: 'alert' },
};

export function createStory({ el, bus, registry, clearBtn }) {
  const seen = new Set(); // one story line per task transition
  const name = (id) => registry.get(id)?.card?.name ?? id;

  function add(phase, html, why) {
    el.querySelector('.story-empty')?.remove();
    const p = PHASE[phase];
    const li = document.createElement('li');
    li.className = `story-step ph-${phase}`;
    li.innerHTML = `<span class="ph">${icon(p.icon, 13)}${p.label}</span><div class="story-body"><p>${html}</p>${why ? `<details><summary>Why?</summary><p>${why}</p></details>` : ''}</div>`;
    el.append(li);
    li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function empty() {
    el.innerHTML = '<li class="story-empty muted">Ask something on the left. Each step of the conversation between agents will be explained here.</li>';
    seen.clear();
  }
  clearBtn.addEventListener('click', empty);

  bus.on(({ type, data }) => {
    switch (type) {
      case 'host:discover': {
        const n = data.agents.length;
        add('discover', `The host read the <b>Agent Cards</b> of ${n} agent${n === 1 ? '' : 's'} (${data.agents.map((a) => esc(a.name)).join(', ') || 'none'}) to learn what each one can do.${data.skipped.length ? ` It left out ${data.skipped.map((s) => `${esc(s.name)} (${esc(s.why)})`).join(', ')}.` : ''}`,
          'An A2A agent describes itself in a small JSON file at a well-known address (<code>/.well-known/agent-card.json</code>): name, skills, endpoint, whether it streams, how to authenticate. The host never sees the agent’s code, prompts or tools. The card is all it knows.');
        break;
      }
      case 'host:plan': {
        const fresh = data.calls.filter((c) => !c.taskId);
        const resumed = data.calls.filter((c) => c.taskId);
        if (fresh.length) {
          const names = [...new Set(fresh.map((c) => name(c.agent)))];
          add('delegate', fresh.length > 1
            ? `The host split the job and sent <b>${fresh.length} messages at once</b>, to ${names.map(esc).join(', ')}.`
            : `The host sent one message, to the <b>${esc(names[0])}</b>.`,
            'Each remote agent is an independent service, so the host can hand out work in parallel and wait for all of it. The message is plain language: the host can’t assume anything about how the other agent works inside.');
        }
        for (const c of resumed) {
          add('collaborate', `Your answer went back to the <b>${esc(name(c.agent))}</b> on the <b>same task</b> (<code>${esc(c.taskId.slice(0, 8))}</code>), so it continues where it paused instead of starting over.`,
            'A message that carries a <code>taskId</code> continues that task. The agent keeps its own memory of the task (what city, what it already did); the host only supplies the missing piece.');
        }
        break;
      }
      case 'host:delegate':
        if (data.streaming) seen.add(`streaming:${data.callId}`);
        break;
      case 'task:update': {
        const key = `${data.agentId}:${data.task.id}:${data.state}`;
        if (seen.has(key)) break;
        seen.add(key);
        const who = `<b>${esc(name(data.agentId))}</b>`;
        const tid = `<code>${esc(data.task.id.slice(0, 8))}</code>`;
        const streams = registry.get(data.agentId)?.card?.streaming;
        const msg = (data.task.status?.message?.parts ?? []).filter((p) => p.text).map((p) => p.text).join(' ');
        switch (data.state) {
          case 'TASK_STATE_SUBMITTED':
            if (data.prevState) break;
            add('delegate', `${who} accepted the work as task ${tid}${streams ? ' and is <b>streaming</b> its progress back' : ''}.`,
              streams
                ? 'The host used <code>SendStreamingMessage</code>. The agent keeps the HTTP response open and pushes Server-Sent Events: status updates and artifact pieces as they are ready.'
                : 'A task gives the work an id, so both sides can refer to it later: to check on it (<code>GetTask</code>), cancel it, or continue it.');
            break;
          case 'TASK_STATE_INPUT_REQUIRED':
            add('collaborate', `${who} <b>paused</b> task ${tid} and asked a question: “${esc(shorten(msg, 140))}”`,
              '<code>INPUT_REQUIRED</code> means the task is still open but blocked on an answer. Agents can negotiate like this instead of guessing. The host either answers itself or, as here, relays the question to you.');
            break;
          case 'TASK_STATE_COMPLETED': {
            const arts = data.task.artifacts ?? [];
            const parts = arts.reduce((n, a) => n + a.parts.length, 0);
            add('result', `${who} finished task ${tid} and returned ${arts.length ? `<b>${arts.length} artifact${arts.length > 1 ? 's' : ''}</b> (${parts} parts: text plus JSON data)` : 'a status message'}.`,
              'Results come back as <b>artifacts</b>, made of parts: <code>text</code> for people, <code>data</code> (JSON) for machines, or files. The host reads the JSON so it can combine results precisely, not just paste text.');
            break;
          }
          case 'TASK_STATE_FAILED':
            add('problem', `${who} could not do it, so task ${tid} is <b>failed</b>: “${esc(shorten(msg, 140))}”`,
              'A failed task is a normal, structured outcome, not a crash. The host gets the reason and can tell you, try another agent, or carry on with what it has.');
            break;
          case 'TASK_STATE_REJECTED':
            add('problem', `${who} <b>rejected</b> task ${tid}: “${esc(shorten(msg, 140))}”`,
              '<code>REJECTED</code> means the agent chose not to do it, typically because it is outside its skills. It is different from <code>FAILED</code> (tried, but broke).');
            break;
          case 'TASK_STATE_CANCELED':
            add('problem', `Task ${tid} at ${who} was <b>canceled</b>.`, 'The client sent <code>CancelTask</code>. Only tasks that haven’t finished can be canceled.');
            break;
        }
        break;
      }
      case 'task:message':
        add('result', `<b>${esc(name(data.agentId))}</b> answered straight away with a <b>message</b>, without creating a task.`,
          'For quick answers an agent may reply with a Message instead of a Task. There is nothing to track afterwards, so no task id.');
        break;
      case 'wire:end': {
        if (data.events > 2) add('result', `The stream from <b>${esc(name(data.agentId))}</b> carried <b>${data.events} events</b> over ${(data.ms / 1000).toFixed(1)}s, then closed.`,
          'Each event is one JSON-RPC response on the open connection: the task snapshot first, then status updates and artifact chunks (marked <code>append</code> and <code>lastChunk</code>). The stream closes when the task finishes or pauses.');
        break;
      }
      case 'host:approval':
        add('trust', `The host wants to send data to <b>${esc(name(data.agentId))}</b> at <code>${esc(data.host)}</code>, outside this site, so it asked you first.`,
          'A2A defines how agents talk, not who they should trust. Sending a message to an agent hands that data to its operator. Asking first is this client’s policy, and a good habit for any A2A client.');
        break;
      case 'host:delegate:result':
        if (!data.ok && !data.declined) add('problem', `Couldn’t reach <b>${esc(name(data.agentId))}</b>: ${esc(shorten(data.error, 200))}`,
          data.kind === 'blocked' ? 'Browsers only let a page call another site if that site allows it (CORS). Many agents are built for server-to-server calls and don’t. A small proxy you control fixes that.' : 'Errors are reported back to the host as tool results, so the model can explain or work around them.');
        break;
      case 'host:run:end':
        if (data.outcome === 'answered') add('combine', 'The host read the results and wrote the answer you see on the left.', 'The host is a normal agent loop (like in the agent-harness demo). Its only tool is “send a message to a remote agent”; everything it knows came back through A2A.');
        break;
      case 'host:session':
        empty();
        break;
    }
  });

  empty();
}

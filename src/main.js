import { EventBus } from './events.js';
import { APP_CONFIG } from './config.js';
import { initTransport, transportMode } from './a2a/transport.js';
import { A2AClient } from './a2a/client.js';
import { Registry } from './a2a/registry.js';
import { HostAgent } from './host/host.js';
import { PROVIDERS } from './providers/index.js';
import { $, esc, storage } from './ui/util.js';
import { icon } from './ui/icons.js';
import { createSettings } from './ui/settings.js';
import { createAgentsUI } from './ui/agents.js';
import { createChat } from './ui/chat.js';
import { createNetMap } from './ui/netmap.js';
import { createLifecycle } from './ui/lifecycle.js';
import { createStory } from './ui/story.js';
import { createKpis } from './ui/kpis.js';
import { createTechnical } from './ui/technical.js';
import { createTour } from './ui/tour.js';

/**
 * Wiring: one event bus, one A2A client, one agent registry, one host agent,
 * and a set of views that only listen.
 */
const bus = new EventBus();
const local = storage('local');

document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon, el.classList.contains('logo') ? 18 : 16); });
$('#repo-link').href = APP_CONFIG.repoUrl;
if (APP_CONFIG.author) $('#byline').innerHTML = ` · by <a href="${esc(APP_CONFIG.authorUrl)}" target="_blank" rel="noopener">${esc(APP_CONFIG.author)}</a>`;

const settings = createSettings({
  dialog: $('#settings'),
  providers: PROVIDERS,
  onChange: () => { syncMode(); syncSend(); },
  onReset: () => { local.remove('a2a-demo:agents'); location.reload(); },
});
const openSettings = (msg, focus) => settings.open(msg, focus);

const client = new A2AClient({ bus, getProxy: settings.getProxy });
const registry = new Registry({ bus, client, storage: local });
const chat = createChat({ bus, registry, onSuggest: (text) => send(text) });
const host = new HostAgent({ bus, client, registry, getConfig: settings.getConfig, approve: (req) => chat.askApproval(req) });

const agentsUI = createAgentsUI({ registry, bus, settings, openSettings });
createNetMap({ el: $('#netmap'), legendEl: $('#map-legend'), bus, registry });
createLifecycle({ el: $('#lifecycle'), bus, registry });
createStory({ el: $('#story'), bus, registry, clearBtn: $('#story-clear') });
createKpis({ el: $('#kpis'), bus, registry });
const technical = createTechnical({ bus, registry, client });
bus.on(({ type, data }) => { if (type === 'ui:open-agent') agentsUI.openDetail(data.id); });
bus.on(({ type, data }) => { if (type === 'registry:added') chat.notice(`${icon('checkCircle', 14)} Added <b>${esc(data.name)}</b>. The host will see it from your next question.`); });

// ── Mode pill & demo banner ───────────────────────────────────────────────────
function syncMode() {
  const c = settings.getConfig();
  const demo = c.provider.id === 'demo';
  const pill = $('#mode-pill');
  pill.dataset.mode = demo ? 'demo' : settings.isReady() ? 'live' : 'nokey';
  pill.innerHTML = `<span class="dot"></span>${demo ? 'Demo host' : esc(c.model)}`;
  $('#demo-banner').hidden = !demo;
}
$('#mode-pill').addEventListener('click', () => openSettings());
$('#open-settings').addEventListener('click', () => openSettings());
$('#demo-add-key').addEventListener('click', () => openSettings('Pick a provider and paste your API key. The host agent will then be a real LLM deciding which agents to call.'));
syncMode();

// ── Composer ──────────────────────────────────────────────────────────────────
const prompt = $('#prompt');
const sendBtn = $('#send');
const stopBtn = $('#stop');
let ctrl = null;

function syncSend() { sendBtn.disabled = host.running || !prompt.value.trim(); }
prompt.addEventListener('input', () => {
  prompt.style.height = 'auto';
  prompt.style.height = `${Math.min(prompt.scrollHeight, 160)}px`;
  syncSend();
});
prompt.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (!sendBtn.disabled) $('#composer').requestSubmit();
  }
});
$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  send(prompt.value);
});
stopBtn.addEventListener('click', () => ctrl?.abort());

async function send(text) {
  text = text.trim();
  if (!text || host.running) return;
  if (!settings.isReady()) { openSettings('Add an API key for this provider, or switch to the Demo host.'); return; }
  prompt.value = '';
  prompt.style.height = 'auto';
  ctrl = new AbortController();
  sendBtn.hidden = true;
  stopBtn.hidden = false;
  setLive(true);
  try {
    await host.run(text, { signal: ctrl.signal });
  } finally {
    ctrl = null;
    sendBtn.hidden = false;
    stopBtn.hidden = true;
    setLive(false);
    syncSend();
    if (matchMedia('(min-width: 900px)').matches) prompt.focus();
  }
}

function setLive(on) {
  const el = $('#live-indicator');
  el.textContent = on ? 'Live' : 'Idle';
  el.classList.toggle('on', on);
  $('#mobile-tab-behind').classList.toggle('live', on);
}

$('#new-chat').addEventListener('click', () => {
  if (host.running) return;
  host.newSession();
  chat.reset();
});

// ── Views ─────────────────────────────────────────────────────────────────────
document.querySelectorAll('.seg [data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
function setView(v) {
  document.querySelectorAll('.seg [data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
  $('#simple-view').hidden = v !== 'simple';
  $('#tech-view').hidden = v !== 'technical';
  local.write('a2a-demo:view', v);
}
setView(local.read('a2a-demo:view', 'simple'));

document.querySelectorAll('.mobile-tabs [data-pane]').forEach((b) => b.addEventListener('click', () => {
  document.body.dataset.pane = b.dataset.pane;
  document.querySelectorAll('.mobile-tabs [data-pane]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
}));

// ── Tour ──────────────────────────────────────────────────────────────────────
const toPane = (p) => () => { if (matchMedia('(max-width: 899px)').matches) document.querySelector(`.mobile-tabs [data-pane="${p}"]`).click(); };
const tour = createTour({
  steps: [
    { target: '#agentbar', title: 'Remote agents', body: 'These are separate agents the host can delegate to. Each publishes an **Agent Card** describing its skills. Click one to read its card, turn it off, or **add your own** A2A agent by URL.', before: toPane('app') },
    { target: '#chat', title: 'Ask the host', body: 'You only talk to the **host agent**. It reads the cards, decides who can help, and sends them messages. Try the Lisbon trip: three agents work in parallel and one asks you a question.', before: toPane('app') },
    { target: '#map-card', title: 'Watch the conversation', body: 'Every real HTTP exchange between agents is animated here: requests going out, streamed events coming back.', before: () => { toPane('inspector')(); setView('simple'); } },
    { target: '#life-card', title: 'Tasks have states', body: 'Each delegation becomes a **task** on the remote agent: working, waiting for input, completed, failed or rejected.', before: () => { toPane('inspector')(); setView('simple'); } },
    { target: '.seg', title: 'See the raw protocol', body: 'Switch to **Technical** for the exact JSON-RPC requests, each Server-Sent Event, the raw Agent Cards, and the tasks (you can re-fetch or cancel them).', before: toPane('inspector') },
  ],
  onEnd: () => toPane('app')(),
});
$('#start-tour').addEventListener('click', () => tour.start());

// ── Start ─────────────────────────────────────────────────────────────────────
(async () => {
  const mode = await initTransport();
  $('#map-sub').textContent = mode === 'service-worker' ? 'Built-in agents run in this page’s Service Worker' : 'Built-in agents run in-page (Service Worker unavailable)';
  await registry.init();
  syncSend();
  tour.startIfNew();
})();

window.__a2a = { bus, client, registry, host, technical, transportMode };

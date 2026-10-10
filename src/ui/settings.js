import { $, esc, storage } from './util.js';

const local = storage('local');
const session = storage('session');
const SETTINGS_KEY = 'a2a-demo:settings';
const keyName = (id) => `a2a-demo:key:${id}`;

/**
 * Settings: the host model (provider, key, model) and the optional CORS proxy.
 * API keys stay in memory unless "remember" is ticked (then sessionStorage,
 * cleared when the tab closes). They are only ever sent to the model provider,
 * never to an agent.
 */
export function createSettings({ dialog, providers, onChange, onReset }) {
  const saved = local.read(SETTINGS_KEY, {});
  const state = {
    providerId: providers[saved.providerId] ? saved.providerId : 'demo',
    models: saved.models ?? {},
    effort: saved.effort ?? 'low',
    proxy: saved.proxy ?? '',
    keys: {},
    remember: {},
  };
  for (const id of Object.keys(providers)) {
    if (providers[id].retiredModels?.includes(state.models[id])) delete state.models[id];
    const k = session.read(keyName(id));
    if (k) { state.keys[id] = k; state.remember[id] = true; }
  }

  const f = {
    provider: $('#set-provider', dialog), key: $('#set-key', dialog), keyRow: $('#key-row', dialog), keyLink: $('#set-keylink', dialog),
    remember: $('#set-remember', dialog), model: $('#set-model', dialog), modelList: $('#model-list', dialog), modelRow: $('#model-row', dialog),
    effortRow: $('#effort-row', dialog), effort: $('#set-effort', dialog), proxy: $('#set-proxy', dialog),
    error: $('#set-error', dialog), message: $('#set-message', dialog),
  };
  f.provider.innerHTML = Object.values(providers).map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('');

  function syncProviderFields() {
    const p = providers[f.provider.value];
    const needsKey = p.needsKey !== false;
    f.keyRow.hidden = !needsKey;
    f.modelRow.hidden = !needsKey;
    f.effortRow.hidden = !p.supportsEffort;
    f.key.placeholder = p.keyPlaceholder ?? '';
    f.key.value = state.keys[p.id] ?? '';
    f.remember.checked = !!state.remember[p.id];
    f.keyLink.href = p.keyUrl ?? '#';
    f.modelList.innerHTML = p.models.map((m) => `<option value="${esc(m)}"></option>`).join('');
    f.model.value = state.models[p.id] ?? p.defaultModel;
    f.error.textContent = '';
  }

  function open(message = '', focus) {
    f.provider.value = state.providerId;
    f.effort.value = state.effort;
    f.proxy.value = state.proxy;
    f.message.textContent = message;
    f.message.hidden = !message;
    syncProviderFields();
    dialog.showModal();
    (focus === 'proxy' ? f.proxy : f.provider.value === 'demo' ? f.provider : f.key).focus();
  }

  f.provider.addEventListener('change', syncProviderFields);

  dialog.querySelector('form').addEventListener('submit', (e) => {
    if (e.submitter?.value === 'cancel') return;
    e.preventDefault();
    const p = providers[f.provider.value];
    const key = f.key.value.trim();
    if (p.needsKey !== false && !key) {
      f.error.textContent = `Enter your ${p.label} API key, or pick the Demo provider.`;
      f.key.focus();
      return;
    }
    const proxy = f.proxy.value.trim();
    if (proxy && !/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)/.test(proxy)) {
      f.error.textContent = 'The proxy URL must start with https:// (or http://localhost for testing).';
      f.proxy.focus();
      return;
    }
    state.providerId = p.id;
    if (p.needsKey !== false) {
      state.keys[p.id] = key;
      state.remember[p.id] = f.remember.checked;
      if (f.remember.checked) session.write(keyName(p.id), key);
      else session.remove(keyName(p.id));
      state.models[p.id] = f.model.value.trim() || p.defaultModel;
    }
    state.effort = f.effort.value;
    state.proxy = proxy;
    local.write(SETTINGS_KEY, { providerId: state.providerId, models: state.models, effort: state.effort, proxy: state.proxy });
    dialog.close();
    onChange?.(getConfig());
  });

  $('#forget-keys', dialog).addEventListener('click', () => {
    for (const id of Object.keys(providers)) session.remove(keyName(id));
    state.keys = {};
    state.remember = {};
    f.key.value = '';
    f.remember.checked = false;
    f.error.textContent = 'All keys cleared from this tab.';
  });
  $('#reset-all', dialog).addEventListener('click', () => {
    if (!confirm('Remove the agents you added and turn all built-in agents back on?')) return;
    dialog.close();
    onReset?.();
  });

  function getConfig() {
    const provider = providers[state.providerId];
    const model = provider.needsKey === false ? provider.defaultModel : state.models[provider.id] ?? provider.defaultModel;
    return { provider, model, apiKey: state.keys[provider.id] ?? '', effort: state.effort, proxy: state.proxy };
  }
  const isReady = () => {
    const c = getConfig();
    return c.provider.needsKey === false || !!c.apiKey;
  };
  return { open, getConfig, isReady, getProxy: () => state.proxy };
}

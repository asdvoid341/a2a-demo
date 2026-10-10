import { AGENTS_ROOT } from './transport.js';

/**
 * The agent directory: which remote agents the host knows about.
 *
 * Built-in agents are hosted by this site (see sw.js). Agents the visitor adds
 * are stored in localStorage as { cardUrl, useProxy, enabled }; their cards
 * are fetched again on every visit, because a card can change.
 */
const STORE_KEY = 'a2a-demo:agents';
export const BUILTINS = [
  { id: 'fx', icon: 'coin' },
  { id: 'weather', icon: 'sun' },
  { id: 'places', icon: 'pin' },
];

export class Registry {
  constructor({ bus, client, storage }) {
    this.bus = bus;
    this.client = client;
    this.storage = storage;
    this.agents = new Map();
  }

  async init() {
    const saved = this.storage.read(STORE_KEY, { builtins: {}, external: [] });
    for (const b of BUILTINS) {
      this.agents.set(b.id, {
        id: b.id, kind: 'builtin', icon: b.icon, cardUrl: `${AGENTS_ROOT}${b.id}/.well-known/agent-card.json`,
        enabled: saved.builtins?.[b.id] !== false, useProxy: false, status: 'loading', card: null, error: null,
      });
    }
    for (const e of saved.external ?? []) {
      this.agents.set(e.id, { id: e.id, kind: 'external', icon: 'globe', cardUrl: e.cardUrl, enabled: e.enabled !== false, useProxy: !!e.useProxy, status: 'loading', card: null, error: null });
    }
    this.changed();
    await Promise.all([...this.agents.values()].map((a) => this.load(a)));
  }

  /** (Re)fetch an agent's card. This is A2A discovery. */
  async load(agent) {
    agent.status = 'loading';
    agent.error = null;
    this.changed();
    try {
      const card = await this.client.discover(agent.cardUrl, { useProxy: agent.useProxy, agentId: agent.id });
      agent.card = card;
      agent.status = card.errors.length ? 'error' : 'ready';
      agent.error = card.errors[0] ?? null;
    } catch (err) {
      agent.status = 'error';
      agent.error = err.message;
    }
    this.changed();
    return agent;
  }

  /** Fetch a card without adding it, so the visitor can review it first. */
  preview(url, { useProxy }) {
    return this.client.discover(url, { useProxy, agentId: 'preview' });
  }

  addExternal({ cardUrl, card, useProxy }) {
    const base = (card.name || new URL(cardUrl).host).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'agent';
    let id = base;
    for (let n = 2; this.agents.has(id); n++) id = `${base}-${n}`;
    const agent = { id, kind: 'external', icon: 'globe', cardUrl, enabled: true, useProxy, status: card.errors.length ? 'error' : 'ready', card, error: card.errors[0] ?? null };
    this.agents.set(id, agent);
    this.save();
    this.changed();
    return agent;
  }

  remove(id) {
    if (this.agents.get(id)?.kind !== 'external') return;
    this.agents.delete(id);
    this.save();
    this.changed();
  }

  setEnabled(id, enabled) {
    const a = this.agents.get(id);
    if (!a) return;
    a.enabled = enabled;
    this.save();
    this.changed();
  }

  setProxy(id, useProxy) {
    const a = this.agents.get(id);
    if (!a) return;
    a.useProxy = useProxy;
    this.save();
    this.load(a);
  }

  get(id) { return this.agents.get(id); }
  all() { return [...this.agents.values()]; }
  /** Agents the host may delegate to: enabled, with a usable card. */
  usable() { return this.all().filter((a) => a.enabled && a.status === 'ready' && a.card?.rpcUrl); }

  save() {
    const builtins = {};
    const external = [];
    for (const a of this.agents.values()) {
      if (a.kind === 'builtin') builtins[a.id] = a.enabled;
      else external.push({ id: a.id, cardUrl: a.cardUrl, useProxy: a.useProxy, enabled: a.enabled });
    }
    this.storage.write(STORE_KEY, { builtins, external });
  }

  changed() { this.bus.emit('registry:change', { agents: this.all() }); }
}

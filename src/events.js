/**
 * EventBus: the observability spine. The A2A client, the registry and the host
 * emit an event for every step; every panel on the page is just a subscriber.
 * So the explainer shows what actually happened, not a canned animation.
 */
export class EventBus {
  constructor() {
    this.listeners = new Set();
    this.log = [];
    this.seq = 0;
    this.t0 = performance.now();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(type, data = {}) {
    const evt = { seq: ++this.seq, type, t: Math.round(performance.now() - this.t0), at: new Date().toISOString(), data };
    this.log.push(evt);
    if (this.log.length > 4000) this.log.splice(0, 1000);
    for (const fn of this.listeners) {
      try { fn(evt); } catch (err) { console.error('[event listener]', type, err); }
    }
    return evt;
  }
}

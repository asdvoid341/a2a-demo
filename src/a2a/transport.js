/**
 * Transport for the built-in agents.
 *
 * Preferred: a Service Worker (sw.js) answers requests under ./agents/, so the
 * page reaches its agents over real HTTP. Fallback (Service Workers blocked,
 * e.g. some private windows, or a hard reload): the very same server code is
 * loaded into the page and requests are handed to it directly.
 * Either way the A2A client builds real Request objects and reads real
 * Response objects; only the hop in between differs.
 */
export const AGENTS_ROOT = new URL('agents/', document.baseURI).href;

const SERVER_SCRIPTS = ['src/server/a2a-server.js', 'src/server/agents/weather.js', 'src/server/agents/fx.js', 'src/server/agents/places.js'];

let mode = 'starting';
export const transportMode = () => mode;

export async function initTransport() {
  if ('serviceWorker' in navigator && window.isSecureContext) {
    try {
      const reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
      if (!navigator.serviceWorker.controller && !reg.active) {
        // First visit: wait for the new worker to take control of this page.
        await new Promise((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
          setTimeout(resolve, 5000);
        });
      }
      if (navigator.serviceWorker.controller) {
        mode = 'service-worker';
        return mode;
      }
    } catch (err) {
      console.warn('[a2a] Service Worker unavailable, using in-page agents', err);
    }
  }
  for (const src of SERVER_SCRIPTS) await loadScript(src);
  mode = 'in-page';
  return mode;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src, onload: resolve, onerror: () => reject(new Error(`Could not load ${src}`)) });
    document.head.append(s);
  });
}

/** fetch() that routes built-in agent URLs to the in-page server when there is no Service Worker. */
export function a2aFetch(url, init) {
  if (mode === 'in-page' && String(url).startsWith(AGENTS_ROOT)) {
    return window.A2AServer.route(new Request(url, init), AGENTS_ROOT);
  }
  return fetch(url, init);
}

/**
 * Service Worker: hosts the built-in A2A agents.
 *
 * Every request to  <site>/agents/<id>/...  is answered here, inside your
 * browser, by a real A2A server (src/server/a2a-server.js). So the page talks
 * to these agents over genuine HTTP: you can open
 *   agents/weather/.well-known/agent-card.json
 * in a new tab, and every JSON-RPC call shows up in DevTools → Network.
 * The agents themselves call public APIs (Open-Meteo, Frankfurter, Wikipedia).
 */
importScripts(
  'src/server/a2a-server.js',
  'src/server/agents/weather.js',
  'src/server/agents/fx.js',
  'src/server/agents/places.js',
);

const ROOT = new URL('agents/', self.registration.scope).href;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  if (!event.request.url.startsWith(ROOT)) return;
  event.respondWith(
    A2AServer.route(event.request, ROOT).then(
      (res) => res ?? fetch(event.request),
      (err) => new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'content-type': 'application/json' } }),
    ),
  );
});

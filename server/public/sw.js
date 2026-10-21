// Cache palette CSS only; never cache access links, APIs, or conversations.
const THEME_CACHE = 'jarvis-theme-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && url.pathname === '/theme.css') {
    event.respondWith((async () => {
      const cache = await caches.open(THEME_CACHE);
      try {
        const response = await fetch(event.request);
        if (response.ok) await cache.put('/theme.css', response.clone());
        return response;
      } catch {
        return (await cache.match('/theme.css')) || new Response(':root{--bg:#101315;--core:#cacccc;--text:#cacccc}', {headers:{'Content-Type':'text/css'}});
      }
    })());
  } else if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => new Response(
      '<!doctype html><meta name="viewport" content="width=device-width"><title>JARVIS offline</title><link rel="stylesheet" href="/theme.css"><body style="background:var(--bg);color:var(--text);font:18px sans-serif;padding:2em">JARVIS is offline. Connect Tailscale on your phone and check that your computer is running.<p><button style="background:var(--bg);color:var(--core);border:1px solid var(--core);padding:.5em" onclick="location.reload()">Reconnect</button>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )));
  }
});

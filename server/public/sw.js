// Cache palette CSS and public app icons only; never cache credentials, APIs or chats.
const THEME_CACHE = 'jarvis-theme-v1';
const ICON_CACHE = 'jarvis-icons-v1';
const ICONS = ['/icon-192.png','/icon-512.png','/favicon.ico'];
self.addEventListener('install', event => {self.skipWaiting();event.waitUntil(caches.open(ICON_CACHE).then(cache=>cache.addAll(ICONS)).catch(()=>{}));});
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if(url.origin===self.location.origin && ICONS.includes(url.pathname) && event.request.method==='GET') {
    event.respondWith((async()=>{const cache=await caches.open(ICON_CACHE);const saved=await cache.match(url.pathname);if(saved)return saved;const response=await fetch(event.request);if(response.ok)await cache.put(url.pathname,response.clone());return response;})());
  } else if (url.origin === self.location.origin && url.pathname === '/theme.css') {
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

/* Service worker del dueño: guarda la app para usarla sin internet y recibe archivos desde «Compartir». */
const VERSION = '0.4.7';
const CACHE = 'ozuna-dueno-' + VERSION;
const BANDEJA = 'ozuna-bandeja-dueno';
const ARCHIVOS = ['./', './index.html', './app.js', './datos.js', './ops.js', './reportes.js', './ficha.js', './merge.js', './actividad.js', './sync.js', './manifest.webmanifest', '../shared/core.js', '../shared/ui.js', '../shared/tema.js', '../shared/xlsx.js', '../shared/estilos.css', '../iconos/cuentas-192.png', '../iconos/cuentas-512.png', '../iconos/cuentas-maskable-512.png'];

/* cache:'reload' evita guardar copias viejas que el navegador tenga en su caché HTTP (GitHub Pages las deja 10 minutos). */
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS.map(u => new Request(u, {cache:'reload'}))))); });
self.addEventListener('activate', e => e.waitUntil((async () => {
  for(const k of await caches.keys()) if(k.startsWith('ozuna-dueno-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('message', e => { if(e.data === 'saltar') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if(r.method === 'POST' && u.pathname.endsWith('/recibir')){
    e.respondWith((async () => {
      try {
        const fd = await r.formData(); const c = await caches.open(BANDEJA); let i = 0;
        for(const f of fd.getAll('archivo')) if(f && f.text) await c.put('/bandeja/' + Date.now() + '-' + (i++), new Response(await f.text()));
        const t = fd.get('texto'); if(t) await c.put('/bandeja/' + Date.now() + '-t', new Response(String(t)));
      } catch(err){}
      return Response.redirect(new URL('./?bandeja=1', self.registration.scope).href, 303);
    })());
    return;
  }
  if(r.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(c0 => c0.match(r, {ignoreSearch:true})).then(hit => hit || fetch(r).then(resp => {
    if(resp && resp.ok){ const copia = resp.clone(); caches.open(CACHE).then(c => c.put(r, copia)); }
    return resp;
  }).catch(() => caches.open(CACHE).then(c0 => c0.match('./index.html')))));
});

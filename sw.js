/* Service worker do Painel de Atendimento - Tapeçaria Bahia (v7)
   Estrategia: shell (HTML/CSS/JS/icones) em network-first, cai pro cache se
   offline - garante que o app sempre tenta a versao mais nova primeiro.
   Os dados (Supabase) NAO passam pelo service worker - sao chamadas fetch
   feitas pelo proprio JS da pagina direto pra API do Supabase.
*/
const VERSAO = 'tb-atendimento-v7';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-maskable.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((chaves) =>
      Promise.all(chaves.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // deixa passar direto (Supabase, CDN do supabase-js)

  e.respondWith(
    fetch(req).then((resp) => {
      const copia = resp.clone();
      caches.open(VERSAO).then((c) => c.put(req, copia));
      return resp;
    }).catch(() => caches.match(req))
  );
});

/* Service worker do Painel de Atendimento - Tapeçaria Bahia (v10)

   POR QUE MUDOU (25/07/2026): ate a v9 o app NAO abria sem internet, e o motivo
   nao era obvio. O nova.html ate ficava em cache (o fetch network-first guardava
   toda resposta do proprio site), mas os QUATRO scripts de CDN - React, ReactDOM,
   Babel standalone e supabase-js - sao de outra origem, e a v9 mandava passar
   direto sem cachear. Sem eles o app nao inicia: fica a tela em branco.

   Estrategia agora:
   - Proprio site (HTML/icones): network-first, cai pro cache se offline. Assim o
     Diego sempre pega a versao mais nova quando tem sinal.
   - CDN (jsdelivr): cache-first com atualizacao em segundo plano. Sao URLs com
     versao fixa, entao servir do cache e seguro e deixa o app abrir offline.
   - Dados (Supabase): continuam FORA do service worker. Quem guarda a ultima
     carga pra leitura offline e o proprio app, no localStorage, junto com a hora
     em que ela foi baixada - assim a tela avisa que o dado e velho em vez de
     fingir que esta atualizado. Gravacao offline NAO existe de proposito: fila
     de escrita duplicaria compromisso e as travas do banco recusariam calado.
*/
const VERSAO = 'tb-atendimento-v10';
const SHELL = [
  './',
  './index.html',
  './nova.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-maskable.svg'
];
const CDN = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
  'https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js',
  'https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js',
  'https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSAO);
    // O shell e obrigatorio; se um CDN falhar no install, nao pode derrubar a instalacao
    // inteira - ele entra no cache no primeiro uso com sinal.
    await c.addAll(SHELL);
    await Promise.all(CDN.map((u) => c.add(new Request(u, { mode: 'cors' })).catch(() => null)));
    await self.skipWaiting();
  })());
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

  // CDN: cache-first. Abre offline e ainda economiza dados do celular dele.
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith((async () => {
      const cacheado = await caches.match(req);
      if (cacheado) {
        // Atualiza em segundo plano, sem segurar a tela.
        fetch(req).then((resp) => { if (resp && resp.ok) caches.open(VERSAO).then((c) => c.put(req, resp)); }).catch(() => {});
        return cacheado;
      }
      try {
        const resp = await fetch(req);
        if (resp && resp.ok) { const copia = resp.clone(); caches.open(VERSAO).then((c) => c.put(req, copia)); }
        return resp;
      } catch (err) {
        return new Response('', { status: 504, statusText: 'CDN offline e sem cache' });
      }
    })());
    return;
  }

  // Supabase e qualquer outra origem: passa direto, sem cache (dado nunca fica no SW).
  if (url.origin !== location.origin) return;

  // Proprio site: network-first, cache como rede de seguranca.
  e.respondWith(
    fetch(req).then((resp) => {
      const copia = resp.clone();
      caches.open(VERSAO).then((c) => c.put(req, copia));
      return resp;
    }).catch(() => caches.match(req))
  );
});

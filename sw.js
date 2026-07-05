/* Service worker do Painel de Atendimento - Tapeçaria Bahia
   Estratégia:
   - Shell do app (HTML/CSS/JS/ícones): cache-first (funciona offline).
   - Dados (dados_atendimento.json): network-first, cai pro cache se offline,
     para o painel sempre tentar o mais novo mas nunca ficar em branco.
*/
const VERSAO = 'tb-atendimento-v2';
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
  // network-first também para navegação (index.html): o app pega versão nova
  // no primeiro carregamento com internet, e cai pro cache se estiver offline.
  const ehDados = url.pathname.endsWith('dados_atendimento.json') || req.mode === 'navigate';

  if (ehDados) {
    // network-first para os dados
    e.respondWith(
      fetch(req).then((resp) => {
        const copia = resp.clone();
        caches.open(VERSAO).then((c) => c.put(req, copia));
        return resp;
      }).catch(() => caches.match(req))
    );
  } else {
    // cache-first para o shell
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});

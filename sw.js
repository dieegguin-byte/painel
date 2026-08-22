
/* Service worker do Painel de Atendimento - Tapeçaria Bahia (v12)

   v12 (22/08/2026): mantém toda a estratégia offline da v11 e acopla a aba
   Estoque V2 sem substituir o monólito nova.html. O nova.html é servido com
   estoque-addon.js injetado antes de </body>; a tela dedicada estoque.html
   fica no mesmo shell/cache e usa a mesma sessão Supabase do app.
*/
const VERSAO = 'tb-atendimento-v12';
const CARGA_COMPARTILHADA = './__compartilhado__';
const SHELL = [
  './',
  './index.html',
  './nova.html',
  './estoque.html',
  './estoque-addon.js',
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

async function novaComAbaEstoque(req) {
  let resp = null;
  try {
    resp = await fetch(req);
  } catch (err) {
    resp = await caches.match(req) || await caches.match('./nova.html');
  }
  if (!resp) return new Response('App indisponível offline e sem cache.', { status: 503 });
  const textoOriginal = await resp.text();
  const marcador = 'estoque-addon.js?v=1';
  const texto = textoOriginal.includes(marcador)
    ? textoOriginal
    : textoOriginal.replace('</body>', `<script src="./${marcador}"></script>\n</body>`);
  const headers = new Headers(resp.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.delete('Content-Length');
  const saida = new Response(texto, { status: resp.status, statusText: resp.statusText, headers });
  if (resp.ok) caches.open(VERSAO).then((c) => c.put(req, saida.clone())).catch(() => {});
  return saida;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const alvo = new URL(req.url);

  if (req.method === 'POST' && alvo.origin === location.origin && alvo.pathname.endsWith('/compartilhar')) {
    e.respondWith((async () => {
      try {
        const form = await req.formData();
        const arquivos = form.getAll('arquivos').filter((f) => f && f.size);
        const carga = {
          texto: [form.get('titulo'), form.get('texto'), form.get('link')].filter(Boolean).join('\n').trim(),
          imagens: [],
          em: Date.now()
        };
        const c = await caches.open(VERSAO);
        for (let i = 0; i < arquivos.length; i++) {
          const chave = './__compartilhado_img_' + i + '__';
          await c.put(chave, new Response(arquivos[i], { headers: { 'Content-Type': arquivos[i].type || 'image/jpeg' } }));
          carga.imagens.push(new URL(chave, self.location).href);
        }
        await c.put(CARGA_COMPARTILHADA, new Response(JSON.stringify(carga), { headers: { 'Content-Type': 'application/json' } }));
      } catch (err) {}
      return Response.redirect(new URL('./nova.html?compartilhado=1', self.location).href, 303);
    })());
    return;
  }

  if (req.method !== 'GET') return;
  const url = alvo;

  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith((async () => {
      const cacheado = await caches.match(req);
      if (cacheado) {
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

  if (url.origin !== location.origin) return;

  if (url.pathname.endsWith('/nova.html')) {
    e.respondWith(novaComAbaEstoque(req));
    return;
  }

  e.respondWith(
    fetch(req).then((resp) => {
      const copia = resp.clone();
      caches.open(VERSAO).then((c) => c.put(req, copia));
      return resp;
    }).catch(() => caches.match(req))
  );
});

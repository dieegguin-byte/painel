/* Service worker do Painel de Atendimento - Tapeçaria Bahia (v13)

   v13 (27/08/2026): adiciona SOMENTE o acesso ao Diagnóstico das Inteligências.
   O nova.html continua intacto no repositório; o SW injeta um script pequeno que adiciona
   o atalho na navegação desktop/mobile. A tela de diagnóstico é read-only e consulta views
   RLS do Supabase. Nenhuma regra de orçamento nasce aqui.

   Mantém as correções da v12: shell offline, CDN cache-first com espelho unpkg, share target
   e rede do próprio site network-first sem guardar respostas ruins.
*/
const VERSAO = 'tb-atendimento-v13';
const CARGA_COMPARTILHADA = './__compartilhado__';
const SHELL = [
  './',
  './index.html',
  './nova.html',
  './diagnostico-inteligencias.html',
  './diagnostico-inteligencias-addon.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-maskable.svg'
];
const CDN = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
  'https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js',
  'https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react.production.min.js',
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

async function novaComDiagnostico(req) {
  let resp = null;
  try { resp = await fetch(req); }
  catch (err) { resp = await caches.match(req) || await caches.match('./nova.html'); }
  if (!resp) return new Response('App indisponível offline e sem cache.', { status: 503 });
  if (!resp.ok) {
    const salvo = await caches.match(req) || await caches.match('./nova.html');
    return salvo || resp;
  }
  const textoOriginal = await resp.text();
  const marcador = 'diagnostico-inteligencias-addon.js?v=1';
  const texto = textoOriginal.includes(marcador)
    ? textoOriginal
    : textoOriginal.replace('</body>', `<script src="./${marcador}"></script>\n</body>`);
  const headers = new Headers(resp.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.delete('Content-Length');
  const saida = new Response(texto, { status: resp.status, statusText: resp.statusText, headers });
  caches.open(VERSAO).then((c) => c.put(req, saida.clone())).catch(() => {});
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

  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'unpkg.com') {
    e.respondWith((async () => {
      const cacheado = await caches.match(req);
      if (cacheado && cacheado.ok) {
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
    e.respondWith(novaComDiagnostico(req));
    return;
  }

  e.respondWith((async () => {
    try {
      const resp = await fetch(req);
      if (resp && resp.ok) {
        const copia = resp.clone();
        caches.open(VERSAO).then((c) => c.put(req, copia)).catch(() => {});
        return resp;
      }
      const salvo = await caches.match(req);
      return salvo || resp;
    } catch (err) {
      const salvo = await caches.match(req);
      return salvo || Response.error();
    }
  })());
});

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
/* POR QUE MUDOU DE NOVO (22/08/2026 - TELA PRETA): o app instalado abriu preto, mudo. Duas falhas aqui
   ajudavam nisso, e as duas estao consertadas abaixo:
   1) o network-first guardava QUALQUER resposta do proprio site, inclusive 404 e pagina de portal de
      operadora. Uma vez guardada, a copia ruim era servida offline pra sempre. Agora so resposta ok entra
      no cache, e resposta ruim NAO ganha da copia boa que ja estava guardada;
   2) o cache-first do CDN devolvia o que estivesse guardado sem olhar o status. Agora so devolve se estiver
      ok, e o unpkg (o espelho que o nova.html usa quando o jsdelivr falha) tambem passa a ser cacheado.
   A subida de v11 pra v12 tambem serve de vassoura: o activate apaga todo cache que nao seja o da versao
   atual, entao o celular do Diego joga fora o cache antigo (possivelmente corrompido) na primeira abertura. */
const VERSAO = 'tb-atendimento-v12';
// COMPARTILHAR DO WHATSAPP. O Android entrega o print/texto num POST multipart pra ./compartilhar,
// que NAO existe como arquivo - e nem poderia, o GitHub Pages so serve estatico. O service worker e
// o unico lugar capaz de pegar esse POST. Ele guarda a carga no cache e manda o app abrir; quem le,
// mostra e limpa e o nova.html. NAO gravamos no Supabase daqui de proposito: o SW nao enxerga o
// localStorage da pagina, entao nao tem a sessao do Diego - gravar daqui exigiria um segundo login.
const CARGA_COMPARTILHADA = './__compartilhado__';
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
  const alvo = new URL(req.url);

  // Compartilhamento vindo do WhatsApp (ou de qualquer app) - ver comentario no topo.
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
      } catch (err) {
        // Compartilhamento perdido e ruim; app que nao abre e pior. Segue pro app de qualquer jeito.
      }
      return Response.redirect(new URL('./nova.html?compartilhado=1', self.location).href, 303);
    })());
    return;
  }

  if (req.method !== 'GET') return;
  const url = alvo;

  // CDN: cache-first. Abre offline e ainda economiza dados do celular dele.
  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'unpkg.com') {
    e.respondWith((async () => {
      const cacheado = await caches.match(req);
      if (cacheado && cacheado.ok) {
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

  // Proprio site: network-first, cache como rede de seguranca - mas so resposta BOA entra no cache.
  e.respondWith((async () => {
    try {
      const resp = await fetch(req);
      if (resp && resp.ok) {
        const copia = resp.clone();
        caches.open(VERSAO).then((c) => c.put(req, copia)).catch(() => {});
        return resp;
      }
      // 404, 5xx, portal de operadora: nao guarda e prefere a copia boa que ja existe.
      const salvo = await caches.match(req);
      return salvo || resp;
    } catch (err) {
      const salvo = await caches.match(req);
      return salvo || Response.error();
    }
  })());
});

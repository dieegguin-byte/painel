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
/* v13 (28/08/2026): entrou o ./estoque.html no SHELL. A subida de versao tambem serve de vassoura - o
   activate apaga todo cache que nao seja o da versao atual, entao o celular do Diego para de servir a
   copia velha do nova.html que ainda nao tinha o botao Estoque nem a correcao do Waze. */
/* v14 (29/08/2026): a carga compartilhada passou a guardar NOME e TIPO reais do arquivo (campo `arquivos`).
   Antes so guardava a URL, e o app renomeava tudo pra .jpg - um audio do WhatsApp virava foto. O campo
   `imagens` continua sendo preenchido pra nao quebrar carga antiga parada no cache do aparelho. */
/* v15 (29/08/2026): NOTIFICACAO. Ate a v14 este arquivo nao tinha um `push` nem um `notificationclick` -
   e nenhum outro arquivo do app tinha. "A notificacao nao chega no celular" nunca foi regressao: era
   funcionalidade que nunca existiu. O service worker e o UNICO lugar capaz de receber push com o app
   fechado, entao os dois ouvintes moram aqui embaixo.
   A carga chega CIFRADA (so este aparelho tem a chave), entao o texto vem junto no proprio push e o SW
   nao precisa de rede nem de sessao pra mostrar. Se um dia chegar push sem carga, ainda mostra algo:
   Android que recebe push e nao mostra notificacao acaba revogando a permissao do site. */
/* v16 (30/08/2026): RECIBO DE ENTREGA. A notificacao chegava, mas so quando o Diego abria o app - e do
   servidor eu so enxergava ate o Google, que devolve 201 em 1 segundo e pronto. Agora o proprio service
   worker avisa a hora em que o evento `push` chegou NELE. Se a hora do recibo bater com a do envio, o
   aparelho recebeu na hora e o problema e de EXIBICAO; se o recibo so chegar quando ele abre o app, o
   Android nao acordou o processo e o problema e de ENTREGA. Sao causas diferentes com consertos
   diferentes, e sem esse carimbo as duas parecem iguais de fora. */
/* v18 (16/09/2026): expulsa do cache a UI anterior que ainda exibia o cronograma Codex como acompanhamento vigente. */
/* v19 (13/10/2026): BOTOES NA NOTIFICACAO. Diego mostrou o Niagara respondendo o WA Business sem abrir o
   app e pediu o mesmo. O Chrome no Android aceita ate 2 botoes por notificacao (texto digitado, nao). O
   cartao pra voce chega com as duas primeiras opcoes como botao; o toque manda a letra do botao junto com o
   recibo pra push-enviar?modo=acao, e o banco aplica o plano que ELE gravou no envio. Se nao gravou, abre o
   app no lugar - o toque nunca some calado. */
/* v20 (15/10/2026): TOQUE NO CORPO ABRE NO LUGAR CERTO E NAO APAGA. Diego: "quando clico no card da
   notificacao, quando volta ele some, alem de abrir na tela inicial e nao no compromisso". (1) Com o app ja
   aberto em segundo plano, `abrirApp` so focava a aba e ignorava o ?ir= - agora manda a URL pra aba por
   postMessage e o nova.html abre a ficha/o card sem recarregar. (2) A notificacao de compromisso so fecha
   quando um botao resolve (Feito/Adiar gravado); o toque no corpo deixa ela na barra, que e por onde ele resolve. */
/* v21 (15/10/2026): aviso com botao vibra forte e fica na barra ate ele mexer (requireInteraction). */
const VERSAO = 'tb-atendimento-v25'; // v25 (16/10/2026): celular 9[0-9] depois do DDD (92..95 eram recusados)
// Sem segredo aqui de proposito: este arquivo e publico. O que autentica o recibo e o proprio id, que
// e um uuid que so existe dentro da carga cifrada - quem nao recebeu a notificacao nao tem como chutar.
const PUSH_FUNCAO = 'https://iymlzdcloaeyybhefywp.supabase.co/functions/v1/push-enviar';
function carimbarRecibo(recibo, campo) {
  if (!recibo) return Promise.resolve();
  // no-cors: nao preciso ler a resposta, e assim o navegador nao gasta um preflight OPTIONS justo
  // no momento em que o aparelho quer voltar a dormir.
  return fetch(PUSH_FUNCAO + '?modo=recibo&campo=' + campo + '&recibo=' + encodeURIComponent(recibo),
    { mode: 'no-cors', cache: 'no-store' }).catch(function () {});
}
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
  // Proteção compartilhada de identidade na triagem, carregada antes dos dois HTML.
  './agenda-caixa.js',
  // Estoque e pagina propria, fora do nova.html. Sem estar aqui ela abriria a tela de offline no
  // celular sem sinal, que e justamente onde o Diego confere material antes de sair pra loja.
  './estoque.html',
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
          imagens: [],   // mantido pelo nome antigo: pode haver carga do sw anterior ainda no cache
          arquivos: [],  // nome e tipo REAIS - sem isso o app renomeava tudo pra .jpg e um audio virava foto
          em: Date.now()
        };
        const c = await caches.open(VERSAO);
        for (let i = 0; i < arquivos.length; i++) {
          const chave = './__compartilhado_arq_' + i + '__';
          const tipo = arquivos[i].type || 'application/octet-stream';
          await c.put(chave, new Response(arquivos[i], { headers: { 'Content-Type': tipo } }));
          const url = new URL(chave, self.location).href;
          carga.imagens.push(url);
          carga.arquivos.push({ url: url, nome: arquivos[i].name || ('compartilhado_' + i), tipo: tipo });
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
  //
  // ⚠ NETWORK-FIRST NAO BASTA PARA O HTML. O GitHub Pages manda `Cache-Control: max-age=600`, e este
  // `fetch` passa pelo cache HTTP do proprio Chrome. Resultado medido em 02/09/2026: correcao publicada,
  // Diego fechou o app de vez e reabriu - e continuou vendo o comportamento ANTIGO por ate 10 minutos.
  // Custou tres rodadas de "saiu em branco de novo" ate eu baixar o arquivo do servidor e ver que o
  // servidor estava certo. Fechar o app NAO fura esse cache; so a URL com query nova furava.
  //
  // Para DOCUMENTO (navegacao ou .html) o fetch passa a ser `cache: 'reload'`, que ignora o cache HTTP na
  // ida e ainda revalida. Icone, manifest e a biblioteca do CDN seguem como estavam - eles quase nunca
  // mudam e sao justamente o que vale a pena ficar cacheado no celular dele.
  //
  // Cinto e suspensorio: se o pedido com `reload` falhar por qualquer motivo, cai no fetch normal antes de
  // ir pro cache. Assim este caminho nunca fica PIOR do que era.
  const ehDocumento = req.mode === 'navigate' || new URL(req.url).pathname.endsWith('.html');
  const buscarNaRede = async () => {
    if (!ehDocumento) return fetch(req);
    try {
      return await fetch(new Request(req.url, { cache: 'reload', credentials: 'same-origin' }));
    } catch (err) {
      return fetch(req);
    }
  };
  e.respondWith((async () => {
    try {
      const resp = await buscarNaRede();
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

// NOTIFICACAO CHEGANDO. Quem manda e a Edge Function push-enviar; a carga vem cifrada com a chave deste
// aparelho, entao `e.data.json()` ja e o texto pronto - nada de buscar no Supabase daqui (o SW nao
// enxerga o localStorage da pagina, logo nao tem a sessao do Diego).
self.addEventListener('push', (e) => {
  let aviso = null;
  try { aviso = e.data ? e.data.json() : null; } catch (err) { aviso = null; }
  // SEMPRE mostrar alguma coisa. Push recebido sem notificacao exibida faz o Android mostrar o aviso
  // generico "atualizado em segundo plano" e, se repetir, revogar a permissao do site calado.
  const titulo = (aviso && aviso.titulo) || 'Painel de Atendimento';
  const corpo = (aviso && aviso.corpo) || (e.data ? String(e.data.text() || '').slice(0, 140) : 'Toque para abrir o painel.');
  e.waitUntil(Promise.all([
    // O carimbo vem PRIMEIRO na lista de proposito: se o Android matar o processo no meio, prefiro ter
    // o recibo (que me diz o que aconteceu) do que perder as duas coisas.
    carimbarRecibo(aviso && aviso.recibo, 'recebido'),
    self.registration.showNotification(titulo, {
      body: corpo,
      // A tag carrega o id do item: o mesmo compromisso substitui o aviso anterior em vez de empilhar.
      tag: (aviso && aviso.tag) || 'painel',
      renotify: true,
      icon: './icon-192.png',
      badge: './icon-192.png',
      // Aviso com botao (compromisso, cartao) e pra resolver: vibra forte e NAO some sozinho da barra ate ele
      // mexer (requireInteraction) - Diego, 15/10/2026: "se for uma notificacao com barulho pequeno, nao da pra saber".
      vibrate: botoesDe(aviso).length ? [400, 150, 400, 150, 700] : [80, 40, 80],
      requireInteraction: botoesDe(aviso).length > 0,
      // Botoes (v19). So {action, title}: o que cada um faz ficou no banco, dentro do recibo.
      actions: botoesDe(aviso),
      data: { url: (aviso && aviso.url) || './nova.html', recibo: (aviso && aviso.recibo) || null }
    })
  ]));
});

function botoesDe(aviso) {
  const lista = aviso && Array.isArray(aviso.acoes) ? aviso.acoes : [];
  return lista
    .filter(function (b) { return b && /^a[0-9]$/.test(String(b.action)) && b.title; })
    .slice(0, 2)
    .map(function (b) { return { action: String(b.action), title: String(b.title).slice(0, 20) }; });
}
// BOTAO TOCADO (v19). Vai com modo cors de proposito: preciso LER a resposta pra saber se gravou. GET sem
// cabecalho extra nao dispara preflight, entao continua uma requisicao so. Devolve true se o banco aplicou.
function responderPeloBotao(recibo, acao) {
  if (!recibo) return Promise.resolve(false);
  return fetch(PUSH_FUNCAO + '?modo=acao&recibo=' + encodeURIComponent(recibo) + '&acao=' + encodeURIComponent(acao),
    { mode: 'cors', cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) { return !!(j && j.ok); })
    .catch(function () { return false; });
}

// TOQUE NA NOTIFICACAO. Se o app ja esta aberto numa aba, foca ela - reabrir do zero perderia o que ele
// estava vendo e ainda faria o Babel transpilar 580 KB de novo.
self.addEventListener('notificationclick', (e) => {
  const destino = new URL((e.notification.data && e.notification.data.url) || './nova.html', self.location).href;
  const recibo = e.notification.data && e.notification.data.recibo;
  // Toque num BOTAO: grava sem abrir o app. Se o banco nao confirmar (sem sinal, recibo ja usado, cartao
  // ja fechado no app), cai no toque comum e abre o app - ele ve o cartao e resolve la.
  if (e.action) {
    carimbarRecibo(recibo, 'aberto');
    e.waitUntil(responderPeloBotao(recibo, e.action).then(function (gravou) {
      // Gravou: resolvido, a notificacao sai. Nao gravou: fica na barra e o app abre pra ele resolver la.
      if (gravou) { e.notification.close(); return; }
      return abrirApp(destino);
    }));
    return;
  }
  // Toque no corpo: abre o app no lugar certo e a notificacao CONTINUA na barra (v20). Aviso sem botao
  // (caixa, conta, resumo) fecha como antes - nao tem o que resolver por ali.
  const temBotao = !!(e.notification.actions && e.notification.actions.length);
  if (!temBotao) e.notification.close();
  carimbarRecibo(recibo, 'aberto');
  e.waitUntil(abrirApp(destino));
});

function abrirApp(destino) {
  return (async () => {
    const abertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const janela of abertas) {
      if (janela.url.indexOf(self.location.origin) !== 0) continue;
      if (janela.url.indexOf('nova.html') === -1 && 'navigate' in janela) {
        try { await janela.navigate(destino); } catch (err) { /* aba em estado que nao aceita navegar */ }
      } else if (janela.url.indexOf('nova.html') !== -1 && destino.indexOf('ir=') !== -1) {
        // App ja aberto: nao recarrega (Babel de novo), avisa a aba pra onde ir (v20).
        try { janela.postMessage({ tipo: 'ir', url: destino }); } catch (err) { /* aba sem message */ }
      }
      if ('focus' in janela) return janela.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(destino);
  })();
}

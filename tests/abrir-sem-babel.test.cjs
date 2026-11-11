// ABRIR SEM O BABEL (11/11/2026). O app é compilado no navegador pelo Babel uma vez por versão publicada e o
// resultado fica guardado no aparelho (Cache Storage `tb-babel-v1`, chave = hash do fonte). Até aqui o Babel (3 MB)
// era baixado e executado em TODA abertura, mesmo sem ter o que compilar. Este teste roda os dois scripts de boot do
// nova.html (o do <head>, que carrega as bibliotecas, e o último, que monta o app) num navegador de mentira e confere:
//   · abertura com a cópia compilada guardada: o Babel nem é pedido, e o app abre até com o CDN do Babel fora do ar;
//   · versão nova (ou aparelho sem cache): o Babel entra, compila uma vez e guarda;
//   · biblioteca que não baixa: aparece a tela de socorro em vez de tela preta.
// Não abre o app de verdade nem fala com a rede: as bibliotecas são objetos vazios e o "Babel" só carimba o texto.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { webcrypto } = require('node:crypto');

const html = fs.readFileSync(path.join(__dirname, '..', 'nova.html'), 'utf8');
const soltos = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const cabeca = soltos.find((s) => s.includes('TB.carregarTudo = async function'));
const rodape = soltos.find((s) => s.includes('async function montar()'));
const ENDERECO = 'https://exemplo.test/painel/nova.html';

// Cache Storage de mentira. Um "aparelho" guarda o mesmo armazém entre uma abertura e outra.
function novoArmazem() {
  const caixas = new Map();
  const abs = (k) => new URL(typeof k === 'string' ? k : k.url, ENDERECO).href;
  return {
    caixas,
    async open(nome) {
      if (!caixas.has(nome)) caixas.set(nome, new Map());
      const c = caixas.get(nome);
      return {
        async match(k) { const t = c.get(abs(k)); return t == null ? undefined : new Response(t); },
        async put(k, resp) { c.set(abs(k), await resp.text()); },
        async keys() { return [...c.keys()].map((url) => ({ url })); },
        async delete(k) { return c.delete(abs(k)); },
      };
    },
    async keys() { return [...caixas.keys()]; },
    async delete(nome) { return caixas.delete(nome); },
  };
}

const QUAL = (url) => (/supabase-js/.test(url) ? 'supabase' : /react-dom/.test(url) ? 'ReactDOM' : /\/react@/.test(url) ? 'React' : /babel/.test(url) ? 'Babel' : null);

// Uma abertura do app. `armazem` é o cache do aparelho (ou null: aparelho sem Cache Storage); `falha(nome, url)`
// diz quais downloads de biblioteca dão erro; `fonte` é o texto do app naquela versão.
function abrir({ armazem = novoArmazem(), falha = () => false, fonte = 'const versao = 1;' } = {}) {
  const pedidos = [], injetados = [], compilacoes = [];
  const raiz = { dataset: {}, children: [], innerHTML: '', querySelector: () => null };
  const outros = {};
  const janela = {
    console, URL, TextEncoder, Response, crypto: webcrypto, clearTimeout,
    // O cão de guarda de 20 s não pode segurar o teste aberto: timers longos ficam só anotados.
    setTimeout: (fn, ms) => (ms >= 20000 ? 0 : setTimeout(fn, ms)),
    location: { href: ENDERECO, pathname: '/painel/nova.html', search: '', hash: '', replace() {}, reload() {} },
    navigator: {}, // sem serviceWorker: o registro do sw.js fica fora deste teste
    performance: { getEntriesByType: () => [] },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    history: { state: null, replaceState() {} },
    addEventListener() {},
  };
  janela.window = janela;
  if (armazem) janela.caches = armazem;
  const FALSAS = {
    supabase: () => ({}), React: () => ({}), ReactDOM: () => ({}),
    Babel: () => ({ transform(src, opcoes) { compilacoes.push(opcoes); return { code: '/* compilado */' + src }; } }),
  };
  janela.document = {
    activeElement: null,
    createElement: () => ({}),
    head: { appendChild(s) {
      pedidos.push(s.src);
      const nome = QUAL(s.src);
      setImmediate(() => { if (!nome || falha(nome, s.src)) s.onerror(); else { janela[nome] = FALSAS[nome](); s.onload(); } });
    } },
    body: { appendChild(s) { injetados.push(s.textContent); } },
    getElementById: (id) => (id === 'app-source' ? { textContent: fonte } : id === 'root' ? raiz : (outros[id] = outros[id] || {})),
  };
  vm.createContext(janela);
  vm.runInContext(cabeca, janela, { filename: 'nova.html (boot do head)' });
  vm.runInContext(rodape, janela, { filename: 'nova.html (boot do fim)' });
  return { pedidos, injetados, compilacoes, raiz, armazem, pediu: (nome) => pedidos.filter((u) => QUAL(u) === nome).length };
}

async function ate(condicao, oQue) {
  const fim = Date.now() + 3000;
  while (!condicao()) {
    if (Date.now() > fim) throw new Error('esperei 3 s e não aconteceu: ' + oQue);
    await new Promise((ok) => setTimeout(ok, 5));
  }
}
const abriu = (a) => ate(() => a.injetados.length > 0 || a.raiz.dataset.socorro === '1', 'o app abrir ou cair na tela de socorro');
const guardados = (armazem) => [...((armazem.caixas.get('tb-babel-v1')) || new Map()).keys()];

test('os dois scripts de boot estão no nova.html', () => {
  assert.ok(cabeca, 'não achei o script do <head> que define TB.carregarTudo');
  assert.ok(rodape, 'não achei o script do fim que define montar()');
  assert.ok(/TB\.carregarBabel = async function/.test(cabeca), 'TB.carregarBabel sumiu do boot');
});

test('versão nova: baixa o Babel, compila uma vez e guarda o resultado no aparelho', async () => {
  const a = abrir();
  await abriu(a);
  assert.equal(a.raiz.dataset.socorro, undefined, 'caiu na tela de socorro: ' + a.raiz.innerHTML.slice(0, 300));
  assert.equal(a.compilacoes.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(a.compilacoes[0])), { presets: [['react', { runtime: 'classic' }], 'typescript'], filename: 'app.tsx' });
  assert.deepEqual(a.injetados, ['/* compilado */const versao = 1;']);
  assert.equal(a.pediu('Babel'), 1);
  assert.equal(a.pediu('React'), 1); assert.equal(a.pediu('ReactDOM'), 1); assert.equal(a.pediu('supabase'), 1);
  await ate(() => guardados(a.armazem).length === 1, 'o resultado compilado entrar no cache');
  assert.match(guardados(a.armazem)[0], /\/__tb-app-[0-9a-f]{64}\.js$/);
});

test('abertura seguinte da mesma versão: o Babel nem é pedido e o app sai do que estava guardado', async () => {
  const primeira = abrir();
  await abriu(primeira);
  await ate(() => guardados(primeira.armazem).length === 1, 'o cache da primeira abertura');
  const segunda = abrir({ armazem: primeira.armazem });
  await abriu(segunda);
  assert.equal(segunda.pediu('Babel'), 0, 'o Babel foi pedido numa abertura que não tinha o que compilar');
  assert.equal(segunda.compilacoes.length, 0);
  assert.deepEqual(segunda.injetados, ['/* compilado */const versao = 1;']);
  assert.equal(segunda.pediu('React'), 1); assert.equal(segunda.pediu('ReactDOM'), 1); assert.equal(segunda.pediu('supabase'), 1);
});

test('o app só é injetado depois que React, ReactDOM e supabase chegaram', async () => {
  const primeira = abrir();
  await abriu(primeira);
  await ate(() => guardados(primeira.armazem).length === 1, 'o cache da primeira abertura');
  let reactNaHora = null;
  const segunda = abrir({ armazem: primeira.armazem });
  const corpo = segunda.injetados;
  const empurra = corpo.push.bind(corpo);
  corpo.push = (codigo) => { reactNaHora = segunda.pediu('React') === 1 && segunda.pediu('ReactDOM') === 1 && segunda.pediu('supabase') === 1; return empurra(codigo); };
  await abriu(segunda);
  assert.equal(reactNaHora, true);
});

test('com a cópia compilada guardada, o app abre mesmo com o CDN do Babel fora do ar', async () => {
  const primeira = abrir();
  await abriu(primeira);
  await ate(() => guardados(primeira.armazem).length === 1, 'o cache da primeira abertura');
  const segunda = abrir({ armazem: primeira.armazem, falha: (nome) => nome === 'Babel' });
  await abriu(segunda);
  assert.equal(segunda.raiz.dataset.socorro, undefined);
  assert.equal(segunda.injetados.length, 1);
});

test('publicação nova: compila de novo, guarda a nova e joga fora a cópia da versão anterior', async () => {
  const antiga = abrir({ fonte: 'const versao = 1;' });
  await abriu(antiga);
  await ate(() => guardados(antiga.armazem).length === 1, 'o cache da versão antiga');
  const chaveAntiga = guardados(antiga.armazem)[0];
  const nova = abrir({ armazem: antiga.armazem, fonte: 'const versao = 2;' });
  await abriu(nova);
  assert.equal(nova.pediu('Babel'), 1);
  assert.equal(nova.compilacoes.length, 1);
  assert.deepEqual(nova.injetados, ['/* compilado */const versao = 2;']);
  await ate(() => guardados(nova.armazem).length === 1 && guardados(nova.armazem)[0] !== chaveAntiga, 'a faxina trocar a cópia antiga pela nova');
});

test('aparelho sem Cache Storage (aba anônima): abre pelo caminho de sempre, compilando', async () => {
  const a = abrir({ armazem: null });
  await abriu(a);
  assert.equal(a.raiz.dataset.socorro, undefined);
  assert.equal(a.compilacoes.length, 1);
  assert.equal(a.injetados.length, 1);
});

test('versão nova e o Babel não baixa de nenhum espelho: tela de socorro, não tela preta', async () => {
  const a = abrir({ falha: (nome) => nome === 'Babel' });
  await abriu(a);
  assert.equal(a.raiz.dataset.socorro, '1');
  assert.equal(a.injetados.length, 0);
  assert.equal(a.pediu('Babel'), 3, 'eram três tentativas: jsdelivr, jsdelivr furando o cache e unpkg');
  assert.match(a.raiz.innerHTML, /O app não conseguiu abrir/);
  assert.match(a.raiz.innerHTML, /não carregou: Babel/);
});

test('React não baixa: tela de socorro dizendo qual biblioteca faltou, mesmo com o app guardado', async () => {
  const primeira = abrir();
  await abriu(primeira);
  await ate(() => guardados(primeira.armazem).length === 1, 'o cache da primeira abertura');
  const segunda = abrir({ armazem: primeira.armazem, falha: (nome) => nome === 'React' });
  await abriu(segunda);
  assert.equal(segunda.raiz.dataset.socorro, '1');
  assert.equal(segunda.injetados.length, 0, 'o app não pode ser injetado sem o React na página');
  assert.match(segunda.raiz.innerHTML, /não carregou: .*React/);
});

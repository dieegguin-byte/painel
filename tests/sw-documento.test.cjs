// O SERVICE WORKER E O nova.html (sw.js v29, 11/11/2026). Roda o sw.js de verdade num navegador de mentira e confere
// o que ele faz quando o app pede o documento:
//   · pergunta ao servidor se mudou (`cache: 'no-cache'`), em vez de baixar o arquivo inteiro toda vez (`reload`);
//   · com cópia boa guardada, a rede tem 4 s pra responder; passou disso, abre com a cópia e guarda a nova por trás;
//   · sem cópia guardada, espera a rede (não inventa resposta);
//   · rede caída, 404 ou 5xx: a cópia boa ganha;
//   · link de aviso e atalho do ícone (./nova.html?ir=...) usam a MESMA cópia do nova.html: abrem sem sinal, e não
//     fica uma cópia de 1,3 MB por endereço;
//   · a página de estoque não registra outro endereço de service worker por cima do do app;
//   · a troca de versão do sw.js apaga os caches velhos dele, mas não o do app já compilado nem o do Whisper.
// O relógio é de mentira (mock do node:test): nenhum teste espera 4 s de verdade.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const VERSAO = (fonte.match(/const VERSAO = '([^']+)'/) || [])[1];
const SITE = 'https://exemplo.test/painel/';

class PedidoFalso {
  constructor(url, init = {}) { this.url = String(url); this.method = init.method || 'GET'; this.mode = init.mode || 'cors'; this.cache = init.cache || 'default'; this.credentials = init.credentials; }
}
function novoArmazem(inicial = {}) {
  const caixas = new Map(Object.entries(inicial).map(([nome, itens]) => [nome, new Map(Object.entries(itens))]));
  const chave = (k) => new URL(typeof k === 'string' ? k : k.url, SITE).href;
  const caixa = (nome) => { if (!caixas.has(nome)) caixas.set(nome, new Map()); return caixas.get(nome); };
  const abrir = (nome) => ({
    async match(k) { const r = caixa(nome).get(chave(k)); return r ? r.clone() : undefined; },
    async put(k, resp) { caixa(nome).set(chave(k), resp); },
    async add() {}, async addAll() {},
    async keys() { return [...caixa(nome).keys()].map((url) => ({ url })); },
    async delete(k) { return caixa(nome).delete(chave(k)); },
  });
  return {
    caixas,
    async open(nome) { return abrir(nome); },
    async match(k) { for (const c of caixas.values()) { const r = c.get(chave(k)); if (r) return r.clone(); } return undefined; },
    async keys() { return [...caixas.keys()]; },
    async delete(nome) { return caixas.delete(nome); },
  };
}
// `rede(pedido)` devolve a Response (ou uma promessa dela, ou rejeita). Cada chamada fica anotada em `idas`.
function ligar({ armazem = novoArmazem(), rede }) {
  const ouvintes = {}, idas = [];
  const mundo = {
    console, URL, Response, Request: PedidoFalso,
    setTimeout: (...a) => setTimeout(...a), clearTimeout: (...a) => clearTimeout(...a), // pega o relógio de mentira do teste
    location: new URL('sw.js', SITE),
    caches: armazem,
    fetch: (pedido, init) => { const p = typeof pedido === 'string' ? new PedidoFalso(pedido, init) : pedido; idas.push(p); return Promise.resolve().then(() => rede(p)); },
    addEventListener: (tipo, fn) => { ouvintes[tipo] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {}, matchAll: async () => [] },
    registration: { getNotifications: async () => [], showNotification: async () => {} },
  };
  mundo.self = mundo;
  vm.createContext(mundo);
  vm.runInContext(fonte, mundo, { filename: 'sw.js' });
  const pedir = (url, init = {}) => {
    const evento = { request: new PedidoFalso(new URL(url, SITE).href, init), esperas: [], resposta: undefined, respondWith(p) { this.resposta = Promise.resolve(p); }, waitUntil(p) { this.esperas.push(p); } };
    ouvintes.fetch(evento);
    return evento;
  };
  return { ouvintes, idas, armazem, pedir };
}
const boa = (texto) => new Response(texto, { status: 200, headers: { 'Content-Type': 'text/html' } });
const respiro = async () => { for (let i = 0; i < 8; i++) await new Promise((ok) => setImmediate(ok)); };
const guardada = async (armazem, url = 'nova.html') => { const r = await armazem.match(new URL(url, SITE).href); return r ? r.text() : null; };
// Promessa que ainda não resolveu devolve o marcador; resolvida, devolve o texto da resposta.
const jaVeio = async (promessa) => Promise.race([promessa.then(async (r) => ({ status: r.status, texto: await r.clone().text() })), new Promise((ok) => setImmediate(() => ok('pendente')))]);
const comCopia = () => novoArmazem({ [VERSAO]: { [SITE + 'nova.html']: boa('COPIA GUARDADA') } });

test('o sw.js declara a versão e protege o cache do app compilado', () => {
  assert.match(VERSAO || '', /^tb-atendimento-v\d+$/);
  assert.match(fonte, /const CACHE_COMPILADO = 'tb-babel-v1'/);
});

test('documento: pergunta ao servidor se mudou (no-cache), nunca baixa à força (reload)', async () => {
  const sw = ligar({ armazem: comCopia(), rede: () => boa('VERSAO DO SERVIDOR') });
  const ev = sw.pedir('nova.html', { mode: 'navigate' });
  const resp = await ev.resposta;
  assert.equal(await resp.text(), 'VERSAO DO SERVIDOR');
  assert.equal(sw.idas.length, 1, 'um pedido só pra rede');
  assert.equal(sw.idas[0].cache, 'no-cache');
  assert.equal(sw.idas[0].url, SITE + 'nova.html');
  await respiro();
  assert.equal(await guardada(sw.armazem), 'VERSAO DO SERVIDOR', 'a resposta boa tem que renovar a cópia guardada');
});

test('documento com sinal fraco: aos 4 s abre com a cópia guardada, e a versão nova entra por trás', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sw = ligar({ armazem: comCopia(), rede: () => new Promise((ok) => setTimeout(() => ok(boa('VERSAO DO SERVIDOR')), 20000)) });
  const ev = sw.pedir('nova.html', { mode: 'navigate' });
  await respiro();
  t.mock.timers.tick(3999); await respiro();
  assert.equal(await jaVeio(ev.resposta), 'pendente', 'antes dos 4 s ainda espera a rede');
  t.mock.timers.tick(1); await respiro();
  assert.deepEqual(await jaVeio(ev.resposta), { status: 200, texto: 'COPIA GUARDADA' });
  assert.equal(ev.esperas.length, 1, 'o pedido que ficou pra trás precisa do waitUntil, senão o navegador mata o service worker');
  assert.equal(await guardada(sw.armazem), 'COPIA GUARDADA');
  t.mock.timers.tick(16000); await respiro();
  assert.equal(await guardada(sw.armazem), 'VERSAO DO SERVIDOR', 'quando a rede terminar, a próxima abertura já sai nova');
  assert.equal(sw.idas.length, 1);
});

test('documento sem cópia guardada: espera a rede o quanto for, sem corte de 4 s', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sw = ligar({ rede: () => new Promise((ok) => setTimeout(() => ok(boa('VERSAO DO SERVIDOR')), 20000)) });
  const ev = sw.pedir('nova.html', { mode: 'navigate' });
  await respiro();
  t.mock.timers.tick(10000); await respiro();
  assert.equal(await jaVeio(ev.resposta), 'pendente');
  t.mock.timers.tick(10000); await respiro();
  assert.deepEqual(await jaVeio(ev.resposta), { status: 200, texto: 'VERSAO DO SERVIDOR' });
});

test('documento com a rede caída: a cópia guardada sai na hora', async () => {
  const sw = ligar({ armazem: comCopia(), rede: () => { throw new TypeError('Failed to fetch'); } });
  const resp = await sw.pedir('nova.html', { mode: 'navigate' }).resposta;
  assert.equal(await resp.text(), 'COPIA GUARDADA');
});

test('documento: 404, 5xx ou portal de operadora não entram no cache e a cópia boa ganha', async () => {
  for (const status of [404, 500, 503]) {
    const sw = ligar({ armazem: comCopia(), rede: () => new Response('pagina de erro', { status }) });
    const resp = await sw.pedir('nova.html', { mode: 'navigate' }).resposta;
    assert.equal(await resp.text(), 'COPIA GUARDADA', 'status ' + status);
    await respiro();
    assert.equal(await guardada(sw.armazem), 'COPIA GUARDADA', 'o erro ' + status + ' não pode sobrescrever a cópia boa');
  }
});

test('documento: sem cópia e com erro do servidor, devolve o erro (não inventa página)', async () => {
  const sw = ligar({ rede: () => new Response('fora do ar', { status: 503 }) });
  const resp = await sw.pedir('nova.html', { mode: 'navigate' }).resposta;
  assert.equal(resp.status, 503);
});

// LINK DE AVISO E ATALHO DO ÍCONE. O aviso do celular abre ./nova.html?ir=ficha&id=<cliente> ou ?ir=agenda&card=<id>;
// os atalhos do ícone abrem ?ir=hoje, ?ir=atrasados... O arquivo é o mesmo nova.html.
const LINK_DE_AVISO = 'nova.html?ir=ficha&id=11111111-1111-4111-8111-111111111111';

test('link de aviso sem rede: abre com a cópia do nova.html (antes dava a tela de erro do navegador)', async () => {
  const sw = ligar({ armazem: comCopia(), rede: () => { throw new TypeError('Failed to fetch'); } });
  for (const endereco of [LINK_DE_AVISO, 'nova.html?ir=atrasados', 'nova.html?compartilhado=1']) {
    const resp = await sw.pedir(endereco, { mode: 'navigate' }).resposta;
    assert.equal(resp.status, 200, endereco);
    assert.equal(await resp.text(), 'COPIA GUARDADA', endereco);
  }
});

test('link de aviso com rede: pergunta pelo nova.html sem o "?..." e guarda uma cópia só', async () => {
  const sw = ligar({ armazem: comCopia(), rede: () => boa('VERSAO DO SERVIDOR') });
  const resp = await sw.pedir(LINK_DE_AVISO, { mode: 'navigate' }).resposta;
  assert.equal(await resp.text(), 'VERSAO DO SERVIDOR');
  assert.equal(sw.idas.length, 1);
  assert.equal(sw.idas[0].url, SITE + 'nova.html', 'com o endereço sem o "?..." o servidor pode responder 304 em vez de mandar 400 kB');
  assert.equal(sw.idas[0].cache, 'no-cache');
  await respiro();
  assert.deepEqual([...sw.armazem.caixas.get(VERSAO).keys()], [SITE + 'nova.html'], 'nada de uma cópia por endereço');
  assert.equal(await guardada(sw.armazem), 'VERSAO DO SERVIDOR', 'abrir por um link também renova a cópia de todos');
});

test('link de aviso com sinal fraco: aos 4 s abre com a cópia, igual ao ícone do app', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const sw = ligar({ armazem: comCopia(), rede: () => new Promise((ok) => setTimeout(() => ok(boa('VERSAO DO SERVIDOR')), 20000)) });
  const ev = sw.pedir('nova.html?ir=agenda&card=22222222-2222-4222-8222-222222222222', { mode: 'navigate' });
  await respiro();
  t.mock.timers.tick(3999); await respiro();
  assert.equal(await jaVeio(ev.resposta), 'pendente');
  t.mock.timers.tick(1); await respiro();
  assert.deepEqual(await jaVeio(ev.resposta), { status: 200, texto: 'COPIA GUARDADA' });
});

test('teste de internet da socorro.html (fetch, não abertura de página): rede caída continua dando erro', async () => {
  // A socorro.html busca ./nova.html?socorro=<hora> pra dizer se a internet chega no app. Se o service worker
  // devolvesse a cópia guardada, o teste diria "baixou do servidor" com a rede caída.
  const sw = ligar({ armazem: comCopia(), rede: () => { throw new TypeError('Failed to fetch'); } });
  const resp = await sw.pedir('nova.html?socorro=1762900000000', { mode: 'cors' }).resposta;
  assert.equal(resp.type, 'error');
  const comRede = ligar({ armazem: comCopia(), rede: () => boa('VERSAO DO SERVIDOR') });
  assert.equal(await (await comRede.pedir('nova.html?socorro=1762900000000', { mode: 'cors' }).resposta).text(), 'VERSAO DO SERVIDOR');
  assert.equal(comRede.idas[0].url, SITE + 'nova.html?socorro=1762900000000', 'o teste pede o endereço inteiro, como sempre pediu');
});

test('arquivo que não é documento (ícone): pedido comum, sem no-cache e sem o corte de 4 s', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const armazem = novoArmazem({ [VERSAO]: { [SITE + 'icon.svg']: new Response('ICONE GUARDADO') } });
  const sw = ligar({ armazem, rede: () => new Promise((ok) => setTimeout(() => ok(new Response('ICONE DO SERVIDOR')), 9000)) });
  const ev = sw.pedir('icon.svg');
  await respiro();
  assert.equal(sw.idas[0].cache, 'default');
  t.mock.timers.tick(8999); await respiro();
  assert.equal(await jaVeio(ev.resposta), 'pendente');
  t.mock.timers.tick(1); await respiro();
  assert.deepEqual(await jaVeio(ev.resposta), { status: 200, texto: 'ICONE DO SERVIDOR' });
});

test('pedido pro banco (outra origem): o service worker não toca', () => {
  const sw = ligar({ rede: () => { throw new Error('não era pra buscar'); } });
  const ev = { request: new PedidoFalso('https://banco.exemplo.test/rest/v1/agenda?select=*'), respondWith() { this.respondeu = true; }, waitUntil() {} };
  sw.ouvintes.fetch(ev);
  assert.equal(ev.respondeu, undefined);
  assert.equal(sw.idas.length, 0);
});

test('troca de versão: apaga os caches velhos do sw.js e deixa o app compilado e o Whisper', async () => {
  const armazem = novoArmazem({ 'tb-atendimento-v1': {}, 'tb-atendimento-v28': {}, [VERSAO]: {}, 'tb-babel-v1': { [SITE + '__tb-app-abc.js']: new Response('app compilado') }, 'transformers-cache': {} });
  const sw = ligar({ armazem, rede: () => boa('x') });
  const esperas = [];
  sw.ouvintes.activate({ waitUntil(p) { esperas.push(p); } });
  await Promise.all(esperas);
  assert.deepEqual((await armazem.keys()).sort(), ['tb-babel-v1', VERSAO, 'transformers-cache'].sort());
  assert.equal(armazem.caixas.get('tb-babel-v1').size, 1, 'a cópia compilada do app não pode ser apagada na troca de versão');
});

// A ABA ESTOQUE NÃO PODE TROCAR O SERVICE WORKER DO APP. O estoque.html abre dentro do app (iframe). Se ele registrar
// um endereço de sw.js diferente do que o nova.html registrou, o navegador instala um service worker novo, o app
// recarrega (ele recarrega quando o service worker muda), registra o dele de volta e recarrega de novo: a aba
// aparecia um instante e o app voltava pro Painel (de 13/10 a 11/11/2026). Roda a linha de verdade do estoque.html.
function registroDoEstoque(registroExistente) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'estoque.html'), 'utf8');
  const linhas = html.split('\n').filter((l) => !l.trim().startsWith('//') && /serviceWorker/.test(l) && /register\(/.test(l));
  assert.equal(linhas.length, 1, 'esperava uma linha só registrando o service worker no estoque.html');
  const registrados = [], aoCarregar = [];
  const mundo = {
    navigator: { serviceWorker: { getRegistration: async () => registroExistente, register: (endereco) => { registrados.push(endereco); return Promise.resolve({}); } } },
    window: { addEventListener: (tipo, fn) => { if (tipo === 'load') aoCarregar.push(fn); } },
  };
  vm.createContext(mundo);
  vm.runInContext(linhas[0], mundo, { filename: 'estoque.html' });
  return { registrados, carregar: async () => { for (const fn of aoCarregar) await fn(); await respiro(); } };
}

test('estoque.html dentro do app: com o service worker do app já registrado, não registra outro', async () => {
  const pagina = registroDoEstoque({ scope: SITE, active: { scriptURL: SITE + 'sw.js?v=99' } });
  await pagina.carregar();
  assert.deepEqual(pagina.registrados, []);
});

test('estoque.html aberto direto, sem service worker nenhum: registra um', async () => {
  const pagina = registroDoEstoque(undefined);
  await pagina.carregar();
  assert.equal(pagina.registrados.length, 1);
  assert.match(pagina.registrados[0], /^\.\/sw\.js\?v=\d+$/);
});

// TÍTULO DO CARD EM ATÉ 2 LINHAS (11/11/2026).
// Numa linha só, no celular cabiam umas 19 letras do título: dois cards "Pagar Pix" de valores diferentes ficavam
// iguais na lista, e pra saber qual era só abrindo. Agora o título quebra em até 2 linhas (umas 38 letras); título
// comprido continua terminando em "…". O resto do card não muda.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../nova.html'), 'utf8');
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const source = html.match(/<script type="text\/plain" id="app-source">([\s\S]*?)<\/script>/)[1];

test('o título do card quebra em até 2 linhas em vez de cortar na primeira', () => {
  const regra = css.match(/\.compromisso-idc strong\{([^}]*)\}/);
  assert.ok(regra, 'falta a regra .compromisso-idc strong');
  assert.match(regra[1], /-webkit-line-clamp:2/);
  assert.match(regra[1], /display:-webkit-box/);
  assert.match(regra[1], /-webkit-box-orient:vertical/);
  assert.match(regra[1], /white-space:normal/);
  assert.match(regra[1], /overflow:hidden/);
  assert.doesNotMatch(regra[1], /white-space:nowrap/);
  // A palavra comprida sem espaço (um link, um código) quebra em vez de estourar a largura do card.
  assert.match(regra[1], /overflow-wrap:anywhere/);
  // O nome do cliente e a linha de baixo seguem numa linha só: o card não cresce além das 2 linhas do título.
  assert.match(css, /\.compromisso-cliente\{[^}]*white-space:nowrap/);
  assert.match(css, /\.compromisso-idc>span\{[^}]*white-space:nowrap/);
});

// NÚMERO NUNCA APARECE CORTADO NO MEIO. O corte do título caía no meio do valor ("R$ 100" virava "R$ 10…"), e valor
// cortado lê como outro valor. Cada pedaço com número vira um bloco que não se parte. Valores daqui são inventados.
const inicio = source.indexOf('const RE_PEDACO_COM_NUMERO');
const fim = source.indexOf('function quandoFalado(', inicio);
assert.ok(inicio >= 0 && fim > inicio, 'pedacosComNumero deve vir logo antes de quandoFalado');
const ctx = vm.createContext({});
vm.runInContext(source.slice(inicio, fim), ctx);
const pedacos = (t) => Array.from(ctx.pedacosComNumero(t), (p) => (p.inteiro ? `[${p.t}]` : p.t)).join('');

test('valor em reais vira um bloco só, com o "R$" junto', () => {
  assert.equal(pedacos('Pagar Pix — Fornecedor — R$ 100 (pedido novo)'), 'Pagar Pix — Fornecedor — [R$ 100] (pedido novo)');
  assert.equal(pedacos('Pagar a conta — R$ 1.234,56 — até sábado'), 'Pagar a conta — [R$ 1.234,56] — até sábado');
  assert.equal(pedacos('Buscar tecido R$89,90'), 'Buscar tecido [R$89,90]');
});

test('data, hora, quantidade e valor sem "R$" também não se partem', () => {
  assert.equal(pedacos('Entregar as 7 cadeiras e receber o saldo de 1.300'), 'Entregar as [7] cadeiras e receber o saldo de [1.300]');
  assert.equal(pedacos('Prazo quinta 12/11, depois das 13h'), 'Prazo quinta [12/11,] depois das [13h]');
  assert.equal(pedacos('Parcela 4/4 do cartão (110 reais)'), 'Parcela [4/4] do cartão [(110] reais)');
});

test('texto sem número volta inteiro, sem bloco nenhum; nada se perde nem repete', () => {
  assert.equal(pedacos('Responder a cliente sobre a almofada'), 'Responder a cliente sobre a almofada');
  assert.equal(pedacos(''), '');
  assert.equal(pedacos(null), '');
  for (const t of ['Pagar Pix — R$ 100 e R$ 250', '14:00 Fulana · Entrega das 7 cadeiras', '🔁 18:00 Levar o reciclável', 'a1 b2 c3']) {
    assert.equal(Array.from(ctx.pedacosComNumero(t), (p) => p.t).join(''), t, 'os pedaços juntos são o texto original');
  }
});

test('pedaço comprido com número (link, código) fica como texto comum, pra não estourar a linha', () => {
  const link = 'https://exemplo.test/pedido/123456789';
  assert.equal(pedacos(`Ver ${link} hoje`), `Ver ${link} hoje`);
  assert.equal(pedacos('Código 1234567890123456'), 'Código [1234567890123456]');
  assert.equal(pedacos('Código 12345678901234567'), 'Código 12345678901234567');
});

test('o título do card e as linhas da agenda de hoje usam os blocos, e o bloco não quebra', () => {
  assert.match(source, /<strong>\{comNumeroInteiro\(tituloCard \|\| nomeCliente\)\}<\/strong>/);
  assert.match(source, /<strong>\{comNumeroInteiro\(a\.titulo \|\| "Compromisso pessoal"\)\}<\/strong>/);
  assert.match(source, /className=\{`hoje-linha[^>]*>\{comNumeroInteiro\(linha\.texto\)\}<\/span>/);
  const regra = css.match(/\.num-inteiro\{([^}]*)\}/);
  assert.ok(regra, 'falta a regra .num-inteiro');
  assert.match(regra[1], /display:inline-block/);
  assert.match(regra[1], /white-space:nowrap/);
});

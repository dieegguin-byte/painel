// TÍTULO DO CARD EM ATÉ 2 LINHAS (11/11/2026).
// Numa linha só, no celular cabiam umas 19 letras do título: dois cards "Pagar Pix" de valores diferentes ficavam
// iguais na lista, e pra saber qual era só abrindo. Agora o título quebra em até 2 linhas (umas 38 letras); título
// comprido continua terminando em "…". O resto do card não muda.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../nova.html'), 'utf8');
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

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

// DESCRIÇÃO DO PESSOAL RECOLHIDA (Diego, 15/11/2026: "pessoais a descrição não está recolhível, já está aberta e não
// recolhe"). Descrição longa nasce em 2 linhas com "ver tudo"; o toque abre e outro toque recolhe. Curta fica inteira.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'nova.html'), 'utf8');
const source = html.match(/<script type="text\/plain" id="app-source">([\s\S]*?)<\/script>/)[1];
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

test('descrição longa vira botão que abre e recolhe; curta fica inteira', () => {
  assert.match(source, /const DESCRICAO_PESSOAL_CURTA = \d+;/);
  assert.match(source, /\{p\.descricao && \(String\(p\.descricao\)\.length > DESCRICAO_PESSOAL_CURTA\s*\? <button type="button" className=\{`pessoal-desc\$\{descAberta\[p\.id\] \? " aberta" : ""\}`\} aria-expanded=\{!!descAberta\[p\.id\]\} onClick=\{\(\) => \{ vibrar\(6\); setDescAberta\(\(m\) => \(\{ \.\.\.m, \[p\.id\]: !m\[p\.id\] \}\)\); \}\}><em>\{p\.descricao\}<\/em><b>\{descAberta\[p\.id\] \? "recolher ▴" : "ver tudo ▾"\}<\/b><\/button>\s*: <em>\{p\.descricao\}<\/em>\)\}/);
  const soltas = source.match(/\{p\.descricao && <em>\{p\.descricao\}<\/em>\}/g);
  assert.equal(soltas, null, 'sobrou descrição sem recolher');
});

test('fechada mostra 2 linhas e o botão não tem cara de botão', () => {
  assert.match(css, /\.pessoal-desc:not\(\.aberta\)>em\{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden\}/);
  assert.match(css, /\.pessoal-desc\{[^}]*background:none[^}]*min-height:0/);
});

// TEMA (Diego, 14/11/2026: "em vez de mudar a cor, poderia fazer o tema... aí eu poderia voltar ou ir para outro tema").
// Toda cor do CSS do app é uma variável --c-<hex> que vale a própria cor; o tema "azul e dourado" troca os valores em
// html[data-tema="marca"]. Este teste confere que o marrom continua igual, que não sobrou cor solta (que não mudaria
// de tema), que as cores que o Diego quis manter não mudam, e que a escolha entra antes de desenhar e tem botão.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'nova.html'), 'utf8');
const ini = html.indexOf('<style>');
const css = html.slice(ini, html.indexOf('</style>', ini)).replace(/\/\*[\s\S]*?\*\//g, '');
const source = html.match(/<script type="text\/plain" id="app-source">([\s\S]*?)<\/script>/)[1];
const HEX = /(?<![&\w%])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z])/g;
const padrao = css.match(/:root\{--fonte-titulo:[^}]*\}/);
const tema = css.match(/html\[data-tema="marca"\]\{([^}]*)\}/);

test('cada variável de cor usada existe e vale a própria cor (o marrom não muda)', () => {
  assert.ok(padrao, 'bloco :root das cores sumiu');
  const definidas = new Map([...padrao[0].matchAll(/--c-([0-9a-f]{3,8}):(#[0-9a-fA-F]{3,8})/g)].map((m) => [m[1], m[2].toLowerCase()]));
  for (const [nome, valor] of definidas) assert.equal(valor, '#' + nome, `--c-${nome} tem que valer #${nome}`);
  const usadas = new Set([...css.matchAll(/var\(--c-([0-9a-f]{3,8})\)/g)].map((m) => m[1]));
  const faltando = [...usadas].filter((n) => !definidas.has(n));
  assert.deepEqual(faltando, [], 'cor usada sem definição no :root das cores');
});

test('não sobrou cor solta no CSS (ela não trocaria de tema)', () => {
  const semDefinicoes = css.replace(/:root\{[^}]*\}/g, '').replace(/html\[data-tema="marca"\][^{]*\{[^}]*\}/g, '');
  const soltas = [...semDefinicoes.matchAll(HEX)].map((m) => m[0]);
  assert.deepEqual(soltas, [], 'escreva var(--c-<hex>) e ponha a variável no :root das cores');
});

test('o tema azul e dourado mantém WhatsApp, Remoto, Quente, atrasado e cards ligados', () => {
  assert.ok(tema, 'bloco do tema sumiu');
  for (const fica of ['147a40', '1e9a55', '0b562c', '7fd6c9', 'ffb454', 'f0921f', 'e0b04a', '5cc3b5', 'b48ee6', 'e48aa7', '6aa9e9', 'df6a5d']) {
    assert.doesNotMatch(tema[1], new RegExp(`--c-${fica}[0-9a-f]*:`), `#${fica} tem que ficar igual nos dois temas`);
  }
  assert.match(tema[1], /--orange:#/, 'o laranja vira dourado');
  assert.match(tema[1], /--bg:#/, 'o fundo vira azul');
});

test('a escolha entra antes de desenhar e o menu "⋯" troca o tema', () => {
  const cabeca = html.slice(0, ini);
  assert.match(cabeca, /localStorage\.getItem\("tb-tema"\)==="marca"\)\{document\.documentElement\.setAttribute\("data-tema","marca"\)/);
  assert.match(source, /setTema\(\(t\) => \(t === "marca" \? "marrom" : "marca"\)\)/);
  assert.match(source, /\{tema === "marca" \? "🎨 Voltar pro marrom" : "🎨 Tema azul e dourado"\}/);
  assert.match(source, /window\.localStorage\.setItem\("tb-tema", tema\)/);
});

test('as letras do site existem no repositório', () => {
  for (const f of ['bricolage-grotesque-latin.woff2', 'manrope-latin.woff2']) {
    assert.ok(fs.statSync(path.join(raiz, 'fonts', f)).size > 10000, `fonts/${f}`);
    assert.match(css, new RegExp(`url\\(fonts/${f.replace('.', '\\.')}\\)`));
  }
});

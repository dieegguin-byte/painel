// Compila o nova.html inteiro com o mesmo Babel da publicação e confere que o resultado é JavaScript válido.
// Tela preta já aconteceu duas vezes (22/08 e 02/09/2026) por código publicado sem checar; este é o teste que a
// checagem automática (.github/workflows/checar.yml) roda em todo PR. Não abre o app nem fala com o banco.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'nova.html'), 'utf8');
const abre = '<script type="text/plain" id="app-source">';
const ini = html.indexOf(abre);
const fim = ini < 0 ? -1 : html.indexOf('</script>', ini);
const fonte = ini < 0 || fim < 0 ? '' : html.slice(ini + abre.length, fim);

test('o fonte do app está no lugar de sempre', () => {
  assert.ok(ini > 0 && fim > ini, 'não achei <script type="text/plain" id="app-source"> no nova.html');
  assert.ok(fonte.length > 100000, `fonte do app pequeno demais: ${fonte.length} chars`);
});

test('o nova.html compila com os mesmos presets Babel da publicação e vira JavaScript válido', () => {
  assert.ok(process.env.BAHIA_BABEL_PATH, 'Defina BAHIA_BABEL_PATH=<caminho>/@babel/standalone/babel.min.js (o mesmo @babel/standalone 7 que o app carrega)');
  const Babel = require(process.env.BAHIA_BABEL_PATH);
  // Se alguém mudar os presets no nova.html, este teste tem que mudar junto — por isso ele confere o texto.
  assert.ok(/presets:\s*\[\["react",\s*\{\s*runtime:\s*"classic"\s*\}\],\s*"typescript"\]/.test(html), 'os presets do Babel no nova.html mudaram; atualize este teste junto');
  const saida = Babel.transform(fonte, { presets: [['react', { runtime: 'classic' }], 'typescript'], filename: 'app.tsx' }).code;
  assert.ok(saida && saida.length > 100000, 'Babel devolveu um resultado pequeno demais');
  new vm.Script(saida, { filename: 'app.js' }); // erro de sintaxe no resultado = tela preta no celular
});

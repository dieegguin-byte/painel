// BOTÃO MANU GUARDADO (11/11/2026, lista de melhorias do app). A Manu está desligada desde 02/11 (MANU_LIGADA = false):
// o botão "Manu" da ficha gravava um recado que ninguém lia. O caminho fica no código, atrás da chave. Este teste
// confere que o botão, a caixa do recado, a lista "aguardando a Manu" e o pedido ao banco dependem da chave.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'nova.html'), 'utf8');
const source = html.match(/<script type="text\/plain" id="app-source">([\s\S]*?)<\/script>/)[1];

test('a chave continua desligada e o caminho continua no código', () => {
  assert.match(source, /const MANU_LIGADA = false;/);
  assert.match(source, /async function enviarRecadoManu\(\)/, 'conserta o caminho, não remove o caminho');
});

test('botão, caixa e lista da Manu na ficha dependem da chave', () => {
  assert.match(source, /\{MANU_LIGADA && <button type="button" className=\{`ficha-botao\$\{falarManu \? " aberto" : ""\}`\}/);
  assert.match(source, /\{MANU_LIGADA && falarManu && <div className="recado-manu-caixa">/);
  assert.match(source, /\{MANU_LIGADA && recadosManu\.length > 0 && <div className="recados-manu">/);
  const soltos = source.match(/\{falarManu && |\{recadosManu\.length > 0 && /g);
  assert.equal(soltos, null, 'sobrou pedaço da Manu na ficha sem a chave');
});

test('com a Manu desligada a ficha não pede os recados ao banco', () => {
  const trecho = source.slice(source.indexOf('const load = useCallback(async () => {', source.indexOf('const [falarManu')), source.indexOf('async function enviarRecadoManu()'));
  assert.match(trecho, /MANU_LIGADA\s*\?\s*db\.from\("caixa_entrada"\)[\s\S]*?:\s*Promise\.resolve\(\{ data: \[\] \}\)/);
});

test('a fileira de botões acompanha o número de botões', () => {
  assert.match(source, /<div className="ficha-botoes" style=\{\{ gridTemplateColumns: `repeat\(\$\{\(telefoneWhatsapp\(cliente\.telefone\) \? 1 : 0\) \+ \(MANU_LIGADA \? 1 : 0\) \+ 2\}, 1fr\) 48px` \}\}>/);
});

// BUSCA QUE ACHA QUEM ESTÁ LÁ (11/11/2026, lista de melhorias do app). "jose" não achava "José" em Leads nem em Clientes,
// e telefone só batia digitado com a mesma pontuação gravada. Estes testes rodam o buscaBate de verdade (tirado do
// nova.html) e conferem que as duas listas usam ele. Nomes e telefones são fictícios.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'nova.html'), 'utf8');
const source = html.match(/<script type="text\/plain" id="app-source">([\s\S]*?)<\/script>/)[1];

function pegarFuncao(nome) {
  const inicio = source.indexOf(`function ${nome}(`);
  assert.ok(inicio > 0, `${nome} sumiu do nova.html`);
  let i = source.indexOf('{', inicio), nivel = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') nivel++;
    else if (source[i] === '}' && --nivel === 0) break;
  }
  return source.slice(inicio, i + 1);
}
const ctx = vm.createContext({});
vm.runInContext(pegarFuncao('semAcentoBaixo') + '\n' + pegarFuncao('buscaBate'), ctx);
const buscaBate = (termo, textos, telefones) => vm.runInContext('buscaBate', ctx)(termo, textos, telefones);

test('acento e maiúscula não atrapalham, nos dois sentidos', () => {
  assert.equal(buscaBate('jose', ['José Fulano']), true);
  assert.equal(buscaBate('JOSÉ', ['jose fulano']), true);
  assert.equal(buscaBate('conceicao', ['Maria da Conceição']), true);
  assert.equal(buscaBate('luziania', ['Fulana', 'Luziânia']), true);
  assert.equal(buscaBate('sofa', ['Reforma de sofá 3 lugares']), true);
  assert.equal(buscaBate('jose', ['Fulana']), false);
});

test('termo vazio mostra tudo', () => {
  assert.equal(buscaBate('', ['Fulana']), true);
  assert.equal(buscaBate('   ', []), true);
  assert.equal(buscaBate(undefined, ['Fulana']), true);
});

test('telefone acha com qualquer pontuação, dos dois lados', () => {
  assert.equal(buscaBate('61999990000', ['Fulana', '+55 61 99999-0000'], ['+55 61 99999-0000']), true);
  assert.equal(buscaBate('61 99999-0001', ['Fulano', '5561999990001'], ['5561999990001']), true);
  assert.equal(buscaBate('(61) 99999', ['Fulano'], ['5561999990001']), true);
  assert.equal(buscaBate('0000', ['Fulana'], ['+55 61 99999-0000']), true);
  assert.equal(buscaBate('61988887777', ['Fulana'], ['+55 61 99999-0000']), false);
});

test('número curto ou com letra não vira busca de telefone', () => {
  // 3 dígitos acharia meia base; "sofa 3" é texto, não telefone.
  assert.equal(buscaBate('999', ['Fulana'], ['+55 61 99999-0000']), false);
  assert.equal(buscaBate('sofa 3', ['Fulana'], ['5561999993000']), false);
});

test('ficha sem telefone e sem cidade não quebra', () => {
  assert.equal(buscaBate('fulana', ['Fulana', null, undefined], [null]), true);
  assert.equal(buscaBate('6199', [null], [undefined, null]), false);
});

test('Leads e Clientes usam a busca nova (e Leads acha por cidade e telefone)', () => {
  const leads = source.slice(source.indexOf('const ORDEM_FILA = {'), source.indexOf('function AgendaView('));
  assert.match(leads, /buscaBate\(search, \[service\.clientes\?\.nome, service\.titulo, service\.clientes\?\.cidade\], \[service\.clientes\?\.telefone\]\)/);
  const clientes = source.slice(source.indexOf('function CustomersView('), source.indexOf('function CustomersView(') + 3000);
  assert.match(clientes, /buscaBate\(search, \[nomeDoCliente\(customer\), customer\.telefone, customer\.cidade\], \[customer\.telefone\]\)/);
  assert.doesNotMatch(source, /toLowerCase\(\)\.includes\(search\.toLowerCase\(\)\)/, 'sobrou busca que não ignora acento');
});

test('o helper fica fora do pedaço que o teste de clientes sem nome roda', () => {
  const inicio = source.indexOf('const CLIENTE_SEM_NOME =');
  assert.ok(source.indexOf('function buscaBate(') < inicio);
});

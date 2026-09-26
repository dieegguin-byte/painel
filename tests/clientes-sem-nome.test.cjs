// Recado de 26/09/2026: a aba Clientes derrubava o app inteiro quando um cliente tinha nome NULL
// (`customer.nome.slice(0, 2)` no avatar). Estes testes seguram as três partes da correção.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../nova.html'), 'utf8');
const source = html.match(/<script type="text\/plain" id="app-source">([\s\S]*?)<\/script>/)[1];
const inicio = source.indexOf('const CLIENTE_SEM_NOME =');
const fim = source.indexOf('function CustomersView(', inicio);
assert.ok(inicio > 0 && fim > inicio, 'Os helpers de nome devem vir logo antes de CustomersView');
const ctx = vm.createContext({});
vm.runInContext(source.slice(inicio, fim), ctx);

test('nome vazio de qualquer jeito vira "Sem nome" e avatar "?"', () => {
  for (const cliente of [null, undefined, {}, { nome: null }, { nome: undefined }, { nome: '' }, { nome: '   ' }, { nome: 'Sem nome' }]) {
    assert.equal(ctx.nomeDoCliente(cliente), 'Sem nome', JSON.stringify(cliente));
    assert.equal(ctx.iniciaisDoCliente(cliente), '?', JSON.stringify(cliente));
  }
});

test('nome real continua como está, só aparado', () => {
  assert.equal(ctx.nomeDoCliente({ nome: 'Ana Paula' }), 'Ana Paula');
  assert.equal(ctx.nomeDoCliente({ nome: '  mariana costa ' }), 'mariana costa');
  assert.equal(ctx.iniciaisDoCliente({ nome: 'Ana Paula' }), 'AN');
  assert.equal(ctx.iniciaisDoCliente({ nome: '  mariana' }), 'MA');
});

test('nenhum método de texto é chamado direto em nome de cliente (o campo aceita NULL no banco)', () => {
  // Linha de comentário fica de fora: o próprio comentário da correção cita o código antigo.
  const codigo = source.split('\n').filter((linha) => !/^\s*(\/\/|\*|\{\/\*)/.test(linha)).join('\n');
  const soltos = codigo.match(/\b(customer|cliente)\.nome\.(slice|toUpperCase|toLowerCase|split|trim|localeCompare|includes|replace|startsWith|endsWith|normalize|match|charAt|substring|length)\b/g);
  assert.equal(soltos, null, `use nomeDoCliente() ou (x.nome || ""): ${soltos}`);
});

test('toda aba e as janelas por cima ficam dentro de uma BarreiraDaAba', () => {
  const home = source.slice(source.indexOf('function Home()'), source.indexOf('function agenteTexto('));
  const abre = home.indexOf('<BarreiraDaAba key={tab}');
  const fecha = home.indexOf('</BarreiraDaAba>', abre);
  assert.ok(abre > 0 && fecha > abre, 'as abas devem estar dentro de <BarreiraDaAba key={tab}>');
  const abas = [...home.matchAll(/\{tab === "(\w+)" &&/g)];
  assert.ok(abas.length >= 9, 'esperava achar as abas do app');
  for (const aba of abas) assert.ok(aba.index > abre && aba.index < fecha, `aba "${aba[1]}" fora da barreira`);
  for (const janela of ['GuiaModal', 'FichaModal', 'ExplicarModal', 'ConcluirModal', 'AddAgendaModal']) {
    assert.match(home, new RegExp(`<BarreiraDaAba [^\\n]*?onFechar=\\{\\(\\) => [^}]*\\}><${janela} `), `${janela} sem barreira`);
  }
});

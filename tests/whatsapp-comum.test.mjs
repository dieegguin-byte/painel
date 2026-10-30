// 30/10/2026: a exceção "este cliente abre no WhatsApp comum" saiu do código (repositório público, trazia
// telefone de cliente) e foi pra coluna clientes.whatsapp_comum. Estes testes rodam as funções do nova.html
// com números fictícios.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

const html = await readFile(new URL('../nova.html', import.meta.url), 'utf8');
const source = html.match(/<script type="text\/plain" id="app-source">([\s\S]*?)<\/script>/)[1];

// Mesmo jeito do caixa-fila.test.mjs: pega uma declaração de topo (função que fecha com "}" na coluna 0
// ou const de uma linha).
function pegar(nome) {
  const m = new RegExp(`\\n((?:async )?function ${nome}\\(|const ${nome} =)`).exec(source);
  assert.ok(m, 'não achei ' + nome + ' no nova.html');
  const ini = m.index + 1;
  const linha = source.slice(ini, source.indexOf('\n', ini));
  const saldo = (linha.match(/[{[(]/g) || []).length - (linha.match(/[}\])]/g) || []).length;
  if (saldo === 0) return linha;
  return source.slice(ini, source.indexOf('\n}\n', ini) + 3);
}

const nomes = ['WHATSAPP_PACOTE', 'WHATSAPP_COMUM_POR_NUMERO', 'digitosWhatsappSemPais', 'lembrarWhatsappComum', 'pacoteWhatsapp'];
const app = vm.createContext({});
vm.runInContext(nomes.map(pegar).join('\n') + '\nthis.app = { lembrarWhatsappComum, pacoteWhatsapp, WHATSAPP_COMUM_POR_NUMERO };', app);
const { lembrarWhatsappComum, pacoteWhatsapp, WHATSAPP_COMUM_POR_NUMERO } = app.app;

test('o código não traz telefone de cliente: a lista começa vazia', () => {
  assert.equal(pegar('WHATSAPP_COMUM_POR_NUMERO'), 'const WHATSAPP_COMUM_POR_NUMERO = new Set();');
  lembrarWhatsappComum([], { recomecar: true });
  assert.equal(pacoteWhatsapp('61990000001'), 'com.whatsapp.w4b');
});

test('cliente marcado no banco abre no WhatsApp comum, com ou sem 55 e máscara', () => {
  lembrarWhatsappComum([
    { id: 'a', telefone: '+55 61 99000-0001', whatsapp_comum: true },
    { id: 'b', telefone: '+55 61 99000-0002', whatsapp_comum: false },
    { id: 'c', telefone: null, whatsapp_comum: true },
  ], { recomecar: true });
  assert.equal(pacoteWhatsapp('61990000001'), 'com.whatsapp');
  assert.equal(pacoteWhatsapp('5561990000001'), 'com.whatsapp');
  assert.equal(pacoteWhatsapp('61990000002'), 'com.whatsapp.w4b');
  assert.equal(WHATSAPP_COMUM_POR_NUMERO.size, 1);
});

test('a ficha só acrescenta; a carga da lista recomeça do zero', () => {
  lembrarWhatsappComum([{ telefone: '+55 61 99000-0001', whatsapp_comum: true }], { recomecar: true });
  lembrarWhatsappComum([{ telefone: '+55 61 99000-0003', whatsapp_comum: true }]);
  assert.equal(pacoteWhatsapp('61990000001'), 'com.whatsapp');
  assert.equal(pacoteWhatsapp('61990000003'), 'com.whatsapp');
  lembrarWhatsappComum([{ telefone: '+55 61 99000-0003', whatsapp_comum: false }], { recomecar: true });
  assert.equal(pacoteWhatsapp('61990000001'), 'com.whatsapp.w4b');
  assert.equal(pacoteWhatsapp('61990000003'), 'com.whatsapp.w4b');
});

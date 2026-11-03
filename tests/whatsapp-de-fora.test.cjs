// Número de WhatsApp de fora do Brasil (03/11/2026, cliente com número dos Estados Unidos).
// Exemplos com números fictícios: o repositório é público.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../nova.html'), 'utf8');
const source = html.match(/<script type="text\/plain" id="app-source">([\s\S]*?)<\/script>/)[1];
const linha = (inicio) => {
  const i = source.indexOf(inicio);
  assert.ok(i >= 0, inicio);
  return source.slice(i, source.indexOf('\n', i));
};
const funcao = (nome) => {
  const i = source.indexOf(`function ${nome}(`);
  assert.ok(i >= 0, nome);
  return source.slice(i, source.indexOf('\n}\n', i) + 2);
};
const ctx = vm.createContext({ navigator: { userAgent: 'iPhone' } });
vm.runInContext([
  funcao('normalizePhone'), funcao('ehTelefoneInternacional'), funcao('ehTelefoneFixo'), funcao('corrigirTelefone'), funcao('telefoneWhatsapp'),
  linha('const RE_WAME_NA_NOTA'), funcao('telefoneDaNota'), linha('function ehAndroid('), linha('const WHATSAPP_PACOTE'),
  linha('const WHATSAPP_COMUM_POR_NUMERO'), funcao('digitosWhatsappSemPais'), funcao('pacoteWhatsapp'), linha('function numeroWhatsappComPais('),
  funcao('urlWhatsapp'), funcao('telefoneQuebrado'),
  'Object.assign(this, { ehTelefoneInternacional, corrigirTelefone, telefoneWhatsapp, telefoneDaNota, digitosWhatsappSemPais, urlWhatsapp, telefoneQuebrado, ehTelefoneFixo })',
].join('\n'), ctx);

test('número de fora com + e país é reconhecido e gravado como +dígitos', () => {
  assert.equal(ctx.ehTelefoneInternacional('+1 (555) 010-0199'), true);
  assert.equal(ctx.corrigirTelefone('+1 (555) 010-0199'), '+15550100199');
  assert.equal(ctx.telefoneWhatsapp('+15550100199'), '+15550100199');
  assert.equal(ctx.telefoneQuebrado('+15550100199'), false);
  assert.equal(ctx.ehTelefoneFixo('+15550100199'), false);
});

test('o wa.me do número de fora não ganha 55', () => {
  assert.equal(ctx.urlWhatsapp(ctx.telefoneWhatsapp('+1 555 010 0199'), ''), 'https://wa.me/15550100199');
  assert.equal(ctx.urlWhatsapp(ctx.telefoneWhatsapp('+351 912 000 001'), 'Oi'), 'https://wa.me/351912000001?text=Oi');
});

test('celular brasileiro continua igual', () => {
  assert.equal(ctx.ehTelefoneInternacional('+55 61 99999-0000'), false);
  assert.equal(ctx.corrigirTelefone('+55 61 99999-0000'), '+55 61 99999-0000');
  assert.equal(ctx.corrigirTelefone('61 9999-0000'), '+55 61 99999-0000');
  assert.equal(ctx.telefoneWhatsapp('5561999990000'), '61999990000');
  assert.equal(ctx.urlWhatsapp('61999990000', ''), 'https://wa.me/5561999990000');
  assert.equal(ctx.telefoneQuebrado('+55 61 99999-0000'), false);
});

test('sem o +, 11 dígitos continuam sendo lidos como celular brasileiro', () => {
  assert.equal(ctx.ehTelefoneInternacional('1 555 010 0199'), false);
  assert.equal(ctx.ehTelefoneInternacional('61999990000'), false);
});

test('+61 9… digitado por engano continua celular de Brasília', () => {
  assert.equal(ctx.ehTelefoneInternacional('+61 99999-0000'), false);
  assert.equal(ctx.corrigirTelefone('+61 99999-0000'), '+55 61 99999-0000');
  assert.equal(ctx.ehTelefoneInternacional('+61 9999-0000'), false);
  assert.equal(ctx.corrigirTelefone('+61 9999-0000'), '+55 61 99999-0000');
});

test('WhatsApp comum casa o número de fora pelo país', () => {
  assert.equal(ctx.digitosWhatsappSemPais('+1 555 010 0199'), ctx.digitosWhatsappSemPais(ctx.telefoneWhatsapp('+15550100199')));
  assert.equal(ctx.digitosWhatsappSemPais('+55 61 99999-0000'), '61999990000');
});

test('wa.me na nota: número de fora vira +país, celular brasileiro segue igual', () => {
  assert.equal(ctx.telefoneDaNota({ nota_claude: 'WhatsApp: https://wa.me/15550100199' }), '+15550100199');
  assert.equal(ctx.telefoneDaNota({ nota_claude: 'WhatsApp: https://wa.me/5561999990000' }), '61999990000');
  assert.equal(ctx.telefoneDaNota({ nota_claude: 'WhatsApp: https://wa.me/61999990000' }), '61999990000');
});

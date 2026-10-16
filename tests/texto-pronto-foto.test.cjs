const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../nova.html'), 'utf8');
const source = html.match(/<script type="text\/plain" id="app-source">([\s\S]*?)<\/script>/)[1];
const inicio = source.indexOf('const semAcento = ');
const fim = source.indexOf('// Card de AÇÃO do Painel', inicio);
assert.ok(inicio >= 0 && fim > inicio, 'semAcento deve preceder o gerador do texto pronto');
const ctx = vm.createContext({ money: (v) => `R$ ${v}`, hojeISO: () => '2026-10-16' });
vm.runInContext(source.slice(inicio, fim) + '\nthis.gerar = mensagemPadraoCompromisso;', ctx);

const svc = (extra) => ({ status: 'lead', clientes: { nome: 'Isa Teste' }, ...extra });

test('card de orçamento com foto já recebida não pede foto de novo (Isa, 16/10)', () => {
  const texto = ctx.gerar(
    { tipo: 'remoto', titulo: 'Orçamento — Isa — 2 sofás de canto com puff, tecido e espuma, Luziânia' },
    svc({ proxima_acao: 'Montar o valor com a foto que ela mandou 16/10 14h08 — orçamento do Claude.' }),
    '2026-10-16');
  assert.doesNotMatch(texto, /foto/i);
  assert.match(texto, /fechando seu orçamento/);
});

test('retomada com foto recebida não pede foto', () => {
  const texto = ctx.gerar({ tipo: 'remoto', titulo: 'Retomar contato — Isa' }, svc({ proxima_acao: 'Cliente já mandou foto, falta retorno' }), '2026-10-16');
  assert.doesNotMatch(texto, /me mandar uma foto/i);
});

test('lead sem foto continua pedindo foto', () => {
  const texto = ctx.gerar({ tipo: 'remoto', titulo: 'Retomar contato — Isa' }, svc({ proxima_acao: 'Sem resposta desde ontem' }), '2026-10-16');
  assert.match(texto, /Se me mandar uma foto/);
});

test('"não mandou foto" continua pedindo foto', () => {
  const texto = ctx.gerar({ tipo: 'remoto', titulo: 'Retomar contato — Isa' }, svc({ proxima_acao: 'Ela ainda não mandou foto' }), '2026-10-16');
  assert.match(texto, /Se me mandar uma foto/);
});

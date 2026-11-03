// Cards ligados da mesma saída (03/11/2026): mesma hora não liga, cidade só pelo nome, coluna agenda.saida.
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
const ctx = vm.createContext({});
vm.runInContext([
  linha('const semAcento ='), linha('const LIGA_MINUTOS'), linha('const LIGA_CORES'), linha('function ehRemoto('), linha('function minutosDaHora('),
  funcao('partesDaCidade'), funcao('mesmaCidade'), funcao('ligacoesDaLista'),
  'this.ligacoes = ligacoesDaLista; this.partes = partesDaCidade; this.mesma = mesmaCidade;',
].join('\n'), ctx);
const grupos = (lista) => {
  const mapa = ctx.ligacoes(lista);
  const porCor = {};
  for (const a of lista) { const l = mapa.get(a.id); if (l) (porCor[a.data + '#' + l.cor] ||= []).push(a.id); }
  return Object.values(porCor);
};
const card = (id, hora, cidade, extra = {}) => ({ id, titulo: id, data: '2026-11-03', hora, cidade, tipo: 'presencial', status: 'planejado', ...extra });

test('dois cards na mesma hora não ligam (Marlom 14h e Maria Rita 14h)', () => {
  assert.deepEqual(grupos([card('marlom', '14:00', 'Luziânia'), card('maria', '14:00', null, { tipo: 'comercial' })]), []);
});

test('um minuto depois, na mesma cidade, continua ligando', () => {
  assert.deepEqual(grupos([card('a', '09:50', 'Luziânia'), card('b', '09:51', 'Luziânia')]), [['a', 'b']]);
});

test('a cidade compara só o nome: sem acento, sem UF, sem bairro', () => {
  assert.deepEqual(grupos([card('a', '09:50', 'Luziânia'), card('b', '09:51', 'Luziânia/GO'), card('c', '09:52', 'Jardim Ingá — Luziânia/GO'), card('d', '09:53', 'Luziânia - GO')]), [['a', 'b', 'c', 'd']]);
  assert.ok(ctx.mesma(ctx.partes('Valparaíso'), ctx.partes('Valparaíso de Goiás/GO')));
  assert.ok(ctx.mesma(ctx.partes('Brasília-DF (Asa Norte)'), ctx.partes('Brasília/DF')));
  assert.ok(ctx.mesma(ctx.partes('Jardim do Ingá'), ctx.partes('Jardim Ingá')));
  assert.ok(ctx.mesma(ctx.partes('Ponte Alta (Gama) - DF'), ctx.partes('Gama-DF')));
});

test('cidades diferentes não ligam, nem com nome parecido', () => {
  assert.ok(!ctx.mesma(ctx.partes('Gama'), ctx.partes('Novo Gama')));
  assert.ok(!ctx.mesma(ctx.partes('Riacho Fundo I'), ctx.partes('Riacho Fundo II')));
  assert.ok(!ctx.mesma(ctx.partes('Águas Claras'), ctx.partes('Águas Lindas de Goiás')));
  assert.deepEqual(grupos([card('a', '09:50', 'Luziânia'), card('b', '09:51', 'Santa Maria/DF')]), []);
});

test('mesma saída liga com qualquer hora e cidade; o primeiro card entra pelo id', () => {
  const lista = [card('marlom', '14:00', 'Luziânia'), card('iris', '15:30', 'Santa Maria/DF', { saida: 'marlom' }), card('outro', '15:31', 'Santa Maria/DF')];
  assert.deepEqual(grupos(lista), [['marlom', 'iris']]);
  const mapa = ctx.ligacoes(lista);
  assert.equal(mapa.get('marlom').pos, 'ini');
  assert.equal(mapa.get('iris').pos, 'fim');
});

test('mesma saída em outro dia não liga (card remarcado não leva a viagem)', () => {
  assert.deepEqual(grupos([card('marlom', '14:00', 'Luziânia'), card('iris', '15:30', 'Santa Maria/DF', { saida: 'marlom', data: '2026-11-04' })]), []);
});

test('remoto e pessoal continuam fora, mesmo com saída', () => {
  assert.deepEqual(grupos([card('marlom', '14:00', 'Luziânia'), card('zap', '14:05', null, { tipo: 'remoto', saida: 'marlom' })]), []);
});

test('saída partida entre listas liga quando as listas vão juntas', () => {
  const atrasado = card('marlom', '14:00', 'Luziânia');
  const hoje = card('iris', '15:30', 'Santa Maria/DF', { saida: 'marlom' });
  assert.equal(ctx.ligacoes([atrasado]).size, 0);
  assert.equal(ctx.ligacoes([atrasado, hoje]).size, 2);
});

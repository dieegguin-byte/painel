// Compromisso e rotina DE HOJE que já passaram da hora contam como atrasados (Diego, 13/10/2026).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../nova.html'), 'utf8');
const source = html.match(/<script type="text\/plain" id="app-source">([\s\S]*?)<\/script>/)[1];
const corte = (de, ate) => {
  const inicio = source.indexOf(de);
  const fim = source.indexOf(ate, inicio);
  assert.ok(inicio >= 0 && fim > inicio, `${de} deve preceder ${ate}`);
  return source.slice(inicio, fim);
};
const ctx = vm.createContext({});
vm.runInContext(corte('function somarDias(', 'function corCompromisso('), ctx);
vm.runInContext(corte('function diasDeAtraso(', '// ===== GRUPO RECOLHÍVEL'), ctx);

const hoje = '2026-10-13';
const ids = (lista) => Array.from(lista, (a) => a.id).join(',');
const esperado = (...xs) => xs.join(',');

test('compromisso de hoje vai pra atrasados só depois da hora; sem hora fica no dia', () => {
  const lista = [
    { id: 'marcao', data: hoje, hora: '07:35:00', status: 'planejado' },
    { id: 'francisco', data: hoje, hora: '07:40', status: 'planejado' },
    { id: 'mecanico', data: hoje, hora: '08:00:00', status: 'planejado' },
    { id: 'semhora', data: hoje, hora: null, status: 'planejado' },
    { id: 'ontem', data: '2026-10-12', hora: '07:00', status: 'planejado' },
    { id: 'amanha', data: '2026-10-14', hora: '07:00', status: 'planejado' },
  ];
  const as758 = ctx.separarHojePorHora(lista, hoje, '07:58');
  assert.equal(ids(as758.passou), esperado('marcao', 'francisco'));
  assert.equal(ids(as758.noPrazo), esperado('mecanico', 'semhora'));
  // Em cima da hora ainda não é atraso.
  const as800 = ctx.separarHojePorHora(lista, hoje, '08:00');
  assert.equal(ids(as800.passou), esperado('marcao', 'francisco'));
  const as801 = ctx.separarHojePorHora(lista, hoje, '08:01');
  assert.equal(ids(as801.passou), esperado('marcao', 'francisco', 'mecanico'));
  // Sem relógio (agora nulo) nada é atraso por hora: vale só a data, como antes.
  assert.equal(ids(ctx.separarHojePorHora(lista, hoje, null).passou), esperado());
});

test('rotina com hora que vence hoje passa a atrasada depois da hora', () => {
  const pneu = { titulo: 'Calibrar pneu', intervalo_dias: 3, hora: '07:28', ultima_execucao: '2026-10-10' };
  assert.equal(ctx.statusRotina(pneu, hoje, '07:20').estado, 'hoje');
  assert.equal(ctx.rotinaAtrasada(ctx.statusRotina(pneu, hoje, '07:20')), false);
  assert.equal(ctx.textoRotina(ctx.statusRotina(pneu, hoje, '07:20')), 'Fazer hoje');
  const depois = ctx.statusRotina(pneu, hoje, '07:58');
  assert.equal(depois.estado, 'hoje');
  assert.equal(depois.passouHora, true);
  assert.equal(ctx.rotinaAtrasada(depois), true);
  assert.equal(ctx.textoRotina(depois), 'Passou da hora');
  // Sem hora marcada, ou sem relógio, continua "Fazer hoje".
  assert.equal(ctx.rotinaAtrasada(ctx.statusRotina({ ...pneu, hora: null }, hoje, '23:00')), false);
  assert.equal(ctx.rotinaAtrasada(ctx.statusRotina(pneu, hoje)), false);
  // Atrasada de dias continua atrasada, e a futura continua futura.
  assert.equal(ctx.textoRotina(ctx.statusRotina({ ...pneu, ultima_execucao: '2026-10-08' }, hoje, '07:00')), 'Atrasada 2 dia(s)');
  assert.equal(ctx.statusRotina({ ...pneu, ultima_execucao: '2026-10-12' }, hoje, '23:59').estado, 'futura');
});

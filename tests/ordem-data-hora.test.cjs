const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../nova.html'), 'utf8');
const source = html.match(/<script type="text\/plain" id="app-source">([\s\S]*?)<\/script>/)[1];
const pegar = (nome) => {
  const i = source.indexOf(`function ${nome}(`);
  assert.ok(i >= 0, nome);
  return source.slice(i, source.indexOf('\n', i));
};
const ctx = vm.createContext({});
vm.runInContext([pegar('ehRemoto'), pegar('ehQuente'), pegar('ordenarPorHora'), pegar('ordenarCompromisso'), 'this.ordenar = ordenarCompromisso;'].join('\n'), ctx);
const ordem = (lista) => [...lista].sort(ctx.ordenar).map((a) => a.id);

test('Quente de segunda não passa na frente dos cards de sábado (Rosana, 17/10)', () => {
  const lista = [
    { id: 'eloisa', titulo: '🔥 Buscar sofá — Eloisa', data: '2026-10-19', hora: '13:30', tipo: 'presencial' },
    { id: 'rosana', titulo: '🔥 Ligar pra Rosana Sousa', data: '2026-10-19', hora: '09:15', tipo: 'remoto' },
    { id: 'pamella', titulo: 'Visita — Pamella', data: '2026-10-17', hora: '16:00', tipo: 'presencial' },
    { id: 'pires', titulo: 'Pedir ao Seu Pires o link', data: '2026-10-17', hora: '08:30', tipo: 'remoto' },
    { id: 'capa', titulo: 'Confirmar o valor da capa', data: '2026-10-17', hora: '10:00', tipo: 'remoto' },
  ];
  assert.deepEqual(ordem(lista), ['pires', 'capa', 'pamella', 'rosana', 'eloisa']);
});

test('no mesmo dia vale a hora; sem hora vai pro fim; presencial só desempata a mesma hora', () => {
  const lista = [
    { id: 'semhora', titulo: 'x', data: '2026-10-17', hora: null, tipo: 'presencial' },
    { id: 'remoto10', titulo: 'x', data: '2026-10-17', hora: '10:00', tipo: 'remoto' },
    { id: 'pres10', titulo: 'x', data: '2026-10-17', hora: '10:00', tipo: 'presencial' },
    { id: 'quente11', titulo: '🔥 x', data: '2026-10-17', hora: '11:00', tipo: 'remoto' },
  ];
  assert.deepEqual(ordem(lista), ['pres10', 'remoto10', 'quente11', 'semhora']);
});

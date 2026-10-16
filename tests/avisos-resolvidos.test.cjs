const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../nova.html'), 'utf8');
const source = html.match(/<script type="text\/plain" id="app-source">([\s\S]*?)<\/script>/)[1];
const inicio = source.indexOf('async function fecharAvisosDeCards(');
const fim = source.indexOf('function alarmeSilenciar(', inicio);
assert.ok(inicio >= 0 && fim > inicio, 'fecharAvisosDeCards deve vir antes de alarmeSilenciar');

function montar(tags) {
  const fechados = [];
  const avisos = tags.map((tag) => ({ tag, close: () => fechados.push(tag) }));
  const ctx = vm.createContext({ navigator: { serviceWorker: { getRegistration: async () => ({ getNotifications: async () => avisos }) } } });
  vm.runInContext(source.slice(inicio, fim) + '\nthis.fechar = fecharAvisosDeCards;', ctx);
  return { ctx, fechados };
}

test('aviso de card que saiu da agenda planejada fecha; os outros ficam (Ana, 16/10)', async () => {
  const { ctx, fechados } = montar(['agenda-ana', 'agenda-joao', 'resumo-diario', 'duvida-1']);
  await ctx.fechar(new Set(['joao']));
  assert.deepEqual(fechados, ['agenda-ana']);
});

test('Adiar 1h no app fecha só o aviso daquele card', async () => {
  const { ctx, fechados } = montar(['agenda-ana', 'agenda-joao']);
  await ctx.fechar(null, ['joao']);
  assert.deepEqual(fechados, ['agenda-joao']);
});

test('sem service worker não quebra', async () => {
  const ctx = vm.createContext({ navigator: {} });
  vm.runInContext(source.slice(inicio, fim) + '\nthis.fechar = fecharAvisosDeCards;', ctx);
  await ctx.fechar(new Set());
});

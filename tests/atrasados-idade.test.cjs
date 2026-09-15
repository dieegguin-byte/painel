const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../nova.html'), 'utf8');
const source = html.match(/<script type="text\/plain" id="app-source">([\s\S]*?)<\/script>/)[1];
const inicio = source.indexOf('function diasDeAtraso(');
const fim = source.indexOf('function Dashboard(', inicio);
assert.ok(inicio >= 0 && fim > inicio, 'As funções puras de idade devem preceder Dashboard');
const ctx = vm.createContext({});
vm.runInContext(source.slice(inicio, fim), ctx);

const hoje = '2026-09-15';
const ids = (registros) => Array.from(registros, (registro) => registro.id);
const dataHaDias = (dias) => new Date(Date.UTC(2026, 8, 15 - dias)).toISOString().slice(0, 10);
const compromisso = (id, dias, outros = {}) => ({
  id, data: dataHaDias(dias), status: 'planejado', tipo: 'remoto', ...outros,
});

test('idade usa dias civis e respeita os limites 1, 14, 15, 30, 31 e 46', () => {
  for (const dias of [1, 14, 15, 30, 31, 46]) {
    assert.equal(ctx.diasDeAtraso(dataHaDias(dias), hoje), dias, `${dias} dias`);
  }
  assert.equal(ctx.diasDeAtraso(hoje, hoje), 0);
  assert.equal(ctx.diasDeAtraso('2026-09-16', hoje), 0);

  const grupos = ctx.separarAtrasadosPorIdade(
    [1, 14, 15, 30, 31, 46].map((dias) => compromisso(`d${dias}`, dias)), hoje,
  );
  assert.deepEqual(ids(grupos.recentes), ['d1', 'd14']);
  assert.deepEqual(ids(grupos.antigos), ['d15', 'd30', 'd31', 'd46']);
  assert.deepEqual(ids(grupos.acima30), ['d31', 'd46']);
});

test('datas ausentes ou inválidas retornam zero e não entram em nenhuma faixa', () => {
  const invalidas = [
    null, undefined, '', ' ', 'ontem', 20260901,
    '2026-02-29', '2024-02-30', '2026-04-31', '2026-13-01',
    '2026-00-02', '2026-09-00', '2026-09-31', '2026-9-01',
    '2026-09-01T00:00:00Z',
  ];
  for (const data of invalidas) {
    assert.equal(ctx.diasDeAtraso(data, hoje), 0, `data inválida: ${String(data)}`);
    assert.equal(ctx.diasDeAtraso('2026-09-01', data), 0, `hoje inválido: ${String(data)}`);
  }
  const grupos = ctx.separarAtrasadosPorIdade(invalidas.map((data, i) => ({
    id: `invalido${i}`, status: 'planejado', data,
  })), hoje);
  for (const registros of Object.values(grupos)) assert.equal(registros.length, 0);
  for (const entrada of [null, undefined, []]) {
    const vazios = ctx.separarAtrasadosPorIdade(entrada, hoje);
    assert.deepEqual(Object.keys(vazios).sort(), ['acima30', 'antigos', 'recentes']);
    for (const registros of Object.values(vazios)) assert.equal(registros.length, 0);
  }
});

test('viradas de mês, ano e fevereiro bissexto mantêm a idade do calendário', () => {
  const casos = [
    ['2026-08-31', '2026-09-01', 1],
    ['2025-12-31', '2026-01-01', 1],
    ['2024-02-28', '2024-03-01', 2],
    ['2024-02-29', '2024-03-01', 1],
    ['2025-02-28', '2025-03-01', 1],
    ['2024-12-31', '2025-01-14', 14],
  ];
  for (const [data, referencia, esperado] of casos) {
    assert.equal(ctx.diasDeAtraso(data, referencia), esperado, `${data} → ${referencia}`);
  }
});

test('mudanças de horário de verão não encurtam nem alongam os dias civis', () => {
  const fusoAnterior = process.env.TZ;
  try {
    for (const fuso of ['America/New_York', 'America/Sao_Paulo', 'UTC']) {
      process.env.TZ = fuso;
      for (const [data, referencia, esperado] of [
        ['2026-03-07', '2026-03-09', 2],
        ['2026-03-08', '2026-03-09', 1],
        ['2026-10-31', '2026-11-02', 2],
        ['2026-11-01', '2026-11-02', 1],
        ['2018-11-03', '2018-11-05', 2],
      ]) {
        assert.equal(ctx.diasDeAtraso(data, referencia), esperado, `${fuso}: ${data} → ${referencia}`);
      }
    }
  } finally {
    if (fusoAnterior === undefined) delete process.env.TZ;
    else process.env.TZ = fusoAnterior;
  }
});

test('só agenda planejada vencida entra, incluindo registros sem vínculo e pessoal real', () => {
  const entrada = [
    compromisso('sem-vinculo', 1, { servico_id: null, cliente_id: null, hora: null }),
    compromisso('pessoal-real', 14, { pessoal_id: 'p1', tipo: 'pessoal' }),
    compromisso('cliente-direto', 15, { cliente_id: 'c1', servico_id: null }),
    compromisso('retirada-legada', 31, { tipo: 'retirada', servico_id: 's1' }),
    compromisso('presencial', 30, { tipo: 'presencial', hora: '10:00' }),
    compromisso('virtual', 46, { pessoal_virtual: true, pessoal_id: 'p2' }),
    compromisso('hoje', 0),
    compromisso('futuro', -1),
    ...['feito', 'cancelado', 'concluido', 'reagendado', 'novo', undefined]
      .map((status, i) => compromisso(`outro-status${i}`, 46, { status })),
  ];
  const grupos = ctx.separarAtrasadosPorIdade(entrada, hoje);
  assert.deepEqual(ids(grupos.recentes), ['sem-vinculo', 'pessoal-real']);
  assert.deepEqual(ids(grupos.antigos), ['cliente-direto', 'retirada-legada', 'presencial']);
  assert.deepEqual(ids(grupos.acima30), ['retirada-legada']);
});

test('faixas são disjuntas, acima de 30 é subconjunto e nenhum dado comercial é alterado', () => {
  const entrada = [1, 14, 15, 30, 31, 46].map((dias) => compromisso(`d${dias}`, dias, {
    titulo: `Compromisso ${dias}`, servico_id: `s${dias}`, cliente_id: `c${dias}`,
    prazo: '2026-10-01', valor_orcamento: 1234.56, tentativas: 2,
    proxima_acao: 'Aguardar confirmação do cliente',
    comercial: { status: 'producao', sinal: 500, pronto: false },
  }));
  const antes = JSON.stringify(entrada);
  const grupos = ctx.separarAtrasadosPorIdade(entrada, hoje);
  const recentes = new Set(ids(grupos.recentes));
  const antigos = new Set(ids(grupos.antigos));
  assert.equal([...recentes].some((id) => antigos.has(id)), false);
  assert.deepEqual([...recentes, ...antigos].sort(), entrada.map((a) => a.id).sort());
  assert.ok(ids(grupos.acima30).every((id) => antigos.has(id)));
  assert.equal(JSON.stringify(entrada), antes, 'Datas, status, campos comerciais e ordem original permanecem intactos');
  for (const a of [...grupos.recentes, ...grupos.antigos]) {
    assert.deepEqual(a, entrada.find((original) => original.id === a.id));
  }
});

test('38 planejados vencidos produzem 11 recentes, 27 antigos e 23 acima de 30', () => {
  const idades = [
    ...Array.from({ length: 11 }, (_, i) => i + 1),
    15, 20, 29, 30,
    ...Array.from({ length: 23 }, (_, i) => i + 31),
  ];
  const entrada = idades.map((dias, i) => compromisso(`agenda${i}`, dias, {
    hora: i % 3 ? null : '09:00',
    tipo: i % 3 ? 'remoto' : 'presencial',
    titulo: i % 3 ? 'Aguardar retorno do cliente' : 'Retirada',
    servico_id: i % 4 ? `servico${i}` : null,
  }));
  const antes = JSON.stringify(entrada);
  const grupos = ctx.separarAtrasadosPorIdade(entrada, hoje);
  assert.equal(entrada.length, 38);
  assert.equal(grupos.recentes.length, 11);
  assert.equal(grupos.antigos.length, 27);
  assert.equal(grupos.acima30.length, 23);
  assert.equal(new Set([...ids(grupos.recentes), ...ids(grupos.antigos)]).size, 38);
  assert.equal(JSON.stringify(entrada), antes);
});

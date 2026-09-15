const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../nova.html'), 'utf8');
const source = html.match(/<script type="text\/plain" id="app-source">([\s\S]*?)<\/script>/)[1];
const start = source.indexOf('const CRONOGRAMA_FASES =');
const end = source.indexOf('function CronogramaTecnico(', start);
assert.ok(start > 0 && end > start);
const functions = source.slice(start, end);
const ctx = vm.createContext({ URL, Intl });
vm.runInContext(functions, ctx);
const row = (estado, other = {}) => ({ item_id: `TESTE-${estado}`, descricao: 'Exemplo de engenharia', estado, ...other });
const evidence = {
  retorno_url: 'https://docs.google.com/document/d/exemplo-retorno/edit',
  validacao_classic_url: 'https://docs.google.com/document/d/exemplo-validacao/edit',
  readback_tecnico_em: '2026-09-15T13:00:00Z', validacao_classic_em: '2026-09-15T14:00:00Z',
};

test('fases seguem todas as fronteiras do calendário de Brasília', () => {
  for (const [instant, expected, next] of [
    ['2026-09-15T02:59:59Z', null, 'monitor'],
    ['2026-09-15T03:00:00Z', 'monitor', 'financeiro'],
    ['2026-09-18T02:59:59Z', 'monitor', 'financeiro'],
    ['2026-09-18T03:00:00Z', 'financeiro', 'prazos'],
    ['2026-09-22T02:59:59Z', 'financeiro', 'prazos'],
    ['2026-09-22T03:00:00Z', 'prazos', 'materiais'],
    ['2026-09-25T02:59:59Z', 'prazos', 'materiais'],
    ['2026-09-25T03:00:00Z', 'materiais', 'handoff'],
    ['2026-09-27T02:59:59Z', 'materiais', 'handoff'],
    ['2026-09-27T03:00:00Z', 'handoff', null],
    ['2026-09-29T15:00:00Z', 'handoff', null],
    ['2026-10-01T02:59:59Z', 'handoff', null],
    ['2026-10-01T03:00:00Z', null, null],
  ]) {
    const phase = ctx.cronogramaFaseAtual(instant);
    assert.equal(phase.atual?.id || null, expected, instant);
    assert.equal(phase.proxima?.id || null, next, instant);
    assert.equal(phase.encerrado, instant === '2026-10-01T03:00:00Z');
  }
  assert.equal(ctx.cronogramaFaseAtual('inválido').dia, null);
});

test('fuso do computador não muda a data operacional nem estende o plano além de 30/09', () => {
  const previous = process.env.TZ;
  try {
    for (const timezone of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
      process.env.TZ = timezone;
      assert.equal(ctx.cronogramaDiaLocal('2026-09-18T01:00:00Z'), '2026-09-17');
      assert.equal(ctx.cronogramaFaseAtual('2026-10-02T15:00:00Z').encerrado, true);
      assert.equal(ctx.cronogramaFaseAtual('2026-10-02T15:00:00Z').atual, null);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('contadores preservam os estados explícitos e não alteram dados ao passar do prazo', () => {
  const states = ['a_fazer', 'enviado_codex', 'em_execucao', 'retorno_recebido', 'aguardando_validacao_classic', 'concluido', 'bloqueado', 'decisao_negocio_pendente'];
  const items = states.map((state) => Object.freeze(row(state, { ...evidence, valor: 123, comercial: Object.freeze({ status: 'producao' }) })));
  Object.freeze(items);
  const before = JSON.stringify(items);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.cronogramaResumo(items))), { abertos: 7, aguardandoRetorno: 2, aguardandoClassic: 2, bloqueados: 2 });
  ctx.cronogramaFaseAtual('2027-01-01T15:00:00Z');
  assert.equal(JSON.stringify(items), before);
  assert.equal(ctx.cronogramaResumo(items).abertos, 7);
});

test('conclusão requer os dois readbacks com evidências e retorno não equivale a conclusão', () => {
  const done = row('concluido', evidence);
  assert.equal(ctx.cronogramaConclusaoEvidenciada(done), true);
  assert.equal(ctx.cronogramaValidarLeitura({ data: [done], count: 1 }).total, 1);
  for (const key of Object.keys(evidence)) {
    assert.throws(() => ctx.cronogramaValidarLeitura({ data: [{ ...done, [key]: null }], count: 1 }), /resposta_inesperada/, key);
  }
  assert.throws(() => ctx.cronogramaValidarLeitura({ data: [{ ...done, validacao_classic_em: 'amanhã' }], count: 1 }), /resposta_inesperada/);
  assert.equal(ctx.cronogramaValidarLeitura({ data: [row('retorno_recebido')], count: 1 }).resumo.abertos, 1);
});

test('resposta parcial, contagem desconhecida, erro e estado inválido não viram zero pendências', () => {
  for (const response of [
    { data: [], count: null }, { data: [], count: 1 }, { data: [], count: 501 },
    { data: null, count: 0 }, { data: [], count: 0, error: { message: 'offline' } },
    { data: [row('desconhecido')], count: 1 },
    { data: [row('a_fazer'), row('a_fazer')], count: 2 },
  ]) assert.throws(() => ctx.cronogramaValidarLeitura(response));
  assert.equal(ctx.cronogramaValidarLeitura({ data: [], count: 0 }).total, 0);
  const items = Array.from({ length: 500 }, (_, i) => row('a_fazer', { item_id: `EXEMPLO-${i}` }));
  assert.equal(ctx.cronogramaValidarLeitura({ data: items, count: 500 }).total, 500);
  assert.throws(() => ctx.cronogramaValidarLeitura({ data: items, count: 501 }), /resultado_parcial/);
});

test('links recusam protocolos executáveis, credenciais e caracteres de controle', () => {
  for (const value of [null, '', '/local', '//example.com', 'javascript:alert(1)', 'data:text/html,teste',
    'http://example.com', 'https://usuario:senha@example.com', 'https://usuario@example.com', 'https://example.com/\nsegredo']) {
    assert.equal(ctx.cronogramaLinkSeguro(value), null, String(value));
  }
  assert.equal(ctx.cronogramaLinkSeguro('https://docs.google.com/document/d/teste/edit'), 'https://docs.google.com/document/d/teste/edit');
});

function harness({ response = { data: [], count: 0 }, demo = false, dbAbsent = false, offlineDesde = null, deferred = false } = {}) {
  const states = [], effects = [], timers = new Map(), intervals = new Map(), docEvents = new Map(), winEvents = new Map(), calls = [];
  let resolveQuery, id = 0;
  const navigator = { onLine: true };
  const queryPromise = deferred ? new Promise((resolve) => { resolveQuery = resolve; }) : Promise.resolve(response);
  const query = {
    select(...args) { calls.push(['select', ...args]); return this; },
    order(...args) { calls.push(['order', ...args]); return this; },
    limit(...args) { calls.push(['limit', ...args]); return this; },
    abortSignal(signal) { calls.push(['abortSignal', signal]); return queryPromise; },
  };
  const context = vm.createContext({ URL, Intl, AbortController, navigator,
    React: { useRef: (current) => ({ current }) },
    useState(initial) { const index = states.length; states.push(typeof initial === 'function' ? initial() : initial); return [states[index], (value) => { states[index] = value; }]; },
    useEffect(effect) { effects.push(effect); },
    window: { setTimeout(fn, ms) { const key = ++id; timers.set(key, { fn, ms }); return key; }, setInterval(fn, ms) { const key = ++id; intervals.set(key, { fn, ms }); return key; },
      addEventListener(event, fn) { winEvents.set(event, fn); }, removeEventListener(event) { winEvents.delete(event); } },
    document: { visibilityState: 'visible', addEventListener(event, fn) { docEvents.set(event, fn); }, removeEventListener(event) { docEvents.delete(event); } },
    clearTimeout(key) { timers.delete(key); }, clearInterval(key) { intervals.delete(key); },
  });
  vm.runInContext(functions, context);
  const db = dbAbsent ? null : { from(name) { calls.push(['from', name]); return query; } };
  const api = context.useCronogramaTecnico({ db, demo, offlineDesde });
  const cleanup = effects.map((effect) => effect());
  return { states, calls, timers, intervals, context, navigator, docEvents, winEvents, api,
    resolve: (result = response) => resolveQuery(result), cleanup: () => cleanup.forEach((fn) => fn()) };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('leitura usa somente SELECT limitado com contagem exata; relógio local não consulta banco', async () => {
  const h = harness({ response: { data: [row('em_execucao')], count: 1 } });
  await settle();
  assert.equal(h.states[1].tipo, 'ok');
  assert.equal(h.calls.find(([name]) => name === 'from')[1], 'engenharia_itens');
  assert.equal(h.calls.find(([name]) => name === 'select')[2].count, 'exact');
  assert.equal(h.calls.find(([name]) => name === 'limit')[1], 500);
  assert.deepEqual(h.calls.filter(([name]) => name === 'order').map((c) => c[1]), ['criado_em', 'item_id']);
  const previous = h.calls.length;
  assert.equal(h.intervals.size, 1);
  const clock = [...h.intervals.values()][0];
  assert.equal(clock.ms, 60000); clock.fn();
  assert.equal(h.calls.length, previous);
  h.cleanup();
  assert.equal(h.intervals.size, 0);
  assert.equal(h.winEvents.size + h.docEvents.size, 0);
});

test('demonstração, falta de conexão e banco ausente não consultam nem exibem zeros', async () => {
  for (const [options, expected] of [[{ demo: true }, 'demo'], [{ dbAbsent: true }, 'indisponivel'], [{ offlineDesde: '2026-09-15' }, 'offline']]) {
    const h = harness(options); await settle();
    assert.equal(h.states[1].tipo, expected);
    assert.equal(h.states[1].dados, null);
    assert.equal(h.calls.length, 0);
    h.cleanup();
  }
});

test('offline limpa a leitura anterior; voltar à tela consulta novamente sem polling', async () => {
  const h = harness(); await settle();
  assert.equal(h.states[1].tipo, 'ok');
  h.navigator.onLine = false; h.winEvents.get('offline')();
  assert.equal(h.states[1].tipo, 'offline'); assert.equal(h.states[1].dados, null);
  h.navigator.onLine = true; h.winEvents.get('online')(); await settle();
  assert.equal(h.states[1].tipo, 'ok');
  h.context.document.visibilityState = 'hidden'; h.docEvents.get('visibilitychange')();
  assert.equal(h.states[1].dados, null);
  h.context.document.visibilityState = 'visible'; h.docEvents.get('visibilitychange')(); await settle();
  assert.equal(h.states[1].tipo, 'ok');
  assert.equal(h.calls.filter(([name]) => name === 'from').length, 3);
  h.cleanup();
});

test('timeout de 20 segundos e unmount cancelam consulta; resposta tardia não retorna como atual', async () => {
  const timeout = harness({ deferred: true });
  const timer = [...timeout.timers.values()][0];
  assert.equal(timer.ms, 20000); timer.fn(); await settle();
  assert.equal(timeout.states[1].tipo, 'erro'); assert.equal(timeout.states[1].dados, null);
  timeout.resolve(); await settle(); assert.equal(timeout.states[1].tipo, 'erro'); timeout.cleanup();
  const unmounted = harness({ deferred: true });
  unmounted.cleanup(); const before = JSON.stringify(unmounted.states);
  assert.equal(unmounted.calls.find(([name]) => name === 'abortSignal')[1].aborted, true);
  unmounted.resolve(); await settle();
  assert.equal(JSON.stringify(unmounted.states), before);
  assert.equal(unmounted.timers.size + unmounted.intervals.size, 0);
});

test('app inteiro transpila com Babel e o componente tem integração única após o monitor', () => {
  const babelPath = process.env.BAHIA_BABEL_PATH;
  assert.ok(babelPath && fs.existsSync(babelPath), 'Defina BAHIA_BABEL_PATH para o Babel standalone usado pelo app');
  const Babel = require(babelPath);
  const transformed = Babel.transform(source, { presets: ['react'], filename: 'nova.html' }).code;
  assert.ok(transformed.length > 100000);
  assert.doesNotThrow(() => new vm.Script(transformed));
  assert.equal((source.match(/<CronogramaTecnico db=/g) || []).length, 1);
  assert.match(source, /<ConferenciaMonitorCard[^\n]*\/>\s*<CronogramaTecnico/);
});

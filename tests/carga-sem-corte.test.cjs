// CARGA SEM CORTE (11/11/2026). A API devolve no máximo 1000 linhas por pedido, sem avisar. `financeiro` passou de
// mil em 23/10/2026 e o app ficou recebendo só as mil de data mais nova. `buscarTudo` busca em páginas até acabar.
// Roda sem instalar nada: node --test tests/carga-sem-corte.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../nova.html'), 'utf8');
const source = html.match(/<script type="text\/plain" id="app-source">([\s\S]*?)<\/script>/)[1];
const inicio = source.indexOf('const PAGINA_DA_API');
const fim = source.indexOf('// LEITURA OFFLINE (25/07/2026)', inicio);
assert.ok(inicio >= 0 && fim > inicio, 'buscarTudo deve vir logo antes da leitura offline');
const ctx = vm.createContext({ Set });
vm.runInContext(source.slice(inicio, fim) + '\nthis.buscarTudo = buscarTudo; this.PAGINA_DA_API = PAGINA_DA_API;', ctx);
const { buscarTudo } = ctx;

// Uma API de mentira com as mesmas regras da de verdade: corta em `teto` linhas por pedido, devolve a contagem
// quando pedem, e responde PGRST103 quando o começo pedido fica depois do fim (medido na API real em 11/11/2026).
// `mexer(n, tabela)` roda antes de cada pedido e devolve a tabela como ela está naquele instante (o que outro aparelho
// ou a Toqi gravaram entre um pedido e outro).
function apiDeMentira(linhas, { teto = 1000, conta = true, falhaNoPedido = 0, entraNoMeio = null, mexer = null } = {}) {
  const pedidos = [];
  let tabela = linhas.slice();
  const montar = () => ({
    range(de, ate) {
      pedidos.push([de, ate]);
      const n = pedidos.length;
      if (falhaNoPedido && n === falhaNoPedido) return Promise.resolve({ data: null, error: { message: 'caiu a rede', code: 'X' }, count: null });
      if (entraNoMeio && n === entraNoMeio.antesDoPedido) tabela = [entraNoMeio.linha, ...tabela];
      if (mexer) tabela = mexer(n, tabela);
      if (conta && de > 0 && de >= tabela.length) return Promise.resolve({ data: null, error: { message: 'Requested range not satisfiable', code: 'PGRST103' }, count: null });
      const fatia = tabela.slice(de, Math.min(ate + 1, de + teto));
      return Promise.resolve({ data: fatia, error: null, count: conta ? tabela.length : null });
    },
  });
  return { montar, pedidos };
}
const linhas = (n) => Array.from({ length: n }, (_, i) => ({ id: 'l' + i, n: i }));

test('1147 linhas (o financeiro de 11/11/2026): vêm todas, na ordem, em dois pedidos', async () => {
  const api = apiDeMentira(linhas(1147));
  const r = await buscarTudo(api.montar);
  assert.equal(r.error, null);
  assert.equal(r.data.length, 1147);
  assert.deepEqual(Array.from(r.data, (l) => l.n), Array.from({ length: 1147 }, (_, i) => i));
  assert.deepEqual(api.pedidos, [[0, 999], [1000, 1999]]);
});

test('tabela pequena: um pedido só, igual a antes', async () => {
  const api = apiDeMentira(linhas(473));
  const r = await buscarTudo(api.montar);
  assert.equal(r.data.length, 473);
  assert.equal(api.pedidos.length, 1);
});

test('tabela vazia: lista vazia, sem erro', async () => {
  const api = apiDeMentira([]);
  const r = await buscarTudo(api.montar);
  assert.deepEqual(Array.from(r.data), []);
  assert.equal(r.error, null);
  assert.equal(api.pedidos.length, 1);
});

test('exatamente mil linhas: para pela contagem e não pede depois do fim', async () => {
  const api = apiDeMentira(linhas(1000));
  const r = await buscarTudo(api.montar);
  assert.equal(r.data.length, 1000);
  assert.deepEqual(api.pedidos, [[0, 999]]);
});

test('três mil e poucas: segue até acabar', async () => {
  const api = apiDeMentira(linhas(3210));
  const r = await buscarTudo(api.montar);
  assert.equal(r.data.length, 3210);
  assert.equal(api.pedidos.length, 4);
});

test('se a API não devolver a contagem, segue enquanto a página vier cheia', async () => {
  const api = apiDeMentira(linhas(2000), { conta: false });
  const r = await buscarTudo(api.montar);
  assert.equal(r.data.length, 2000);
  assert.deepEqual(api.pedidos, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test('teto do servidor menor que a página (500 por pedido): continua de onde parou', async () => {
  const api = apiDeMentira(linhas(1147), { teto: 500 });
  const r = await buscarTudo(api.montar);
  assert.equal(r.data.length, 1147);
  assert.deepEqual(api.pedidos, [[0, 999], [500, 1499], [1000, 1999]]);
});

test('erro na segunda página vira erro da carga inteira (nunca devolve pela metade)', async () => {
  const api = apiDeMentira(linhas(1147), { falhaNoPedido: 2 });
  const r = await buscarTudo(api.montar);
  assert.equal(r.data, null);
  assert.equal(r.error.message, 'caiu a rede');
});

test('erro já no primeiro pedido volta como erro', async () => {
  const api = apiDeMentira(linhas(10), { falhaNoPedido: 1 });
  const r = await buscarTudo(api.montar);
  assert.equal(r.data, null);
  assert.ok(r.error);
});

test('linha que entra no topo no meio da busca: não aparece duas vezes e vem na mesma carga', async () => {
  const api = apiDeMentira(linhas(1147), { entraNoMeio: { antesDoPedido: 2, linha: { id: 'nova', n: -1 } } });
  const r = await buscarTudo(api.montar);
  const ids = Array.from(r.data, (l) => l.id);
  assert.equal(new Set(ids).size, ids.length, 'sem id repetido');
  assert.equal(ids.filter((id) => id === 'l999').length, 1);
  // A contagem passou de 1147 pra 1148 entre as páginas: busca de novo e a nova vem já nesta carga.
  assert.equal(r.data.length, 1148);
  assert.equal(ids[0], 'nova');
  assert.deepEqual(api.pedidos, [[0, 999], [1000, 1999], [0, 999], [1000, 1999]], 'uma volta a mais, só');
});

// Os três casos abaixo foram montados pela revisão técnica de 11/11/2026 contra a versão sem a segunda volta: em
// cada um, uma linha que existe ficava fora das duas páginas.
const vivas = (tabela) => new Set(tabela.map((l) => l.id));
test('card que sai da lista entre as páginas (Desfazer de um Feito): nenhuma linha viva fica de fora', async () => {
  let depois = null;
  const api = apiDeMentira(linhas(1147), { mexer: (n, t) => (n === 2 ? (depois = t.filter((l) => l.id !== 'l10')) : t) });
  const r = await buscarTudo(api.montar);
  const ids = new Set(Array.from(r.data, (l) => l.id));
  assert.equal(r.error, null);
  assert.deepEqual([...vivas(depois)].filter((id) => !ids.has(id)), [], 'linha viva fora da lista');
  assert.ok(!ids.has('l10'), 'a que saiu não fica na lista');
  assert.equal(r.data.length, 1146);
  assert.equal(api.pedidos.length, 4);
});

test('lançamento antigo que muda de data pra hoje (sobe do fim pro topo): nenhuma linha viva fica de fora', async () => {
  const api = apiDeMentira(linhas(1147), { mexer: (n, t) => (n === 2 ? [t.find((l) => l.id === 'l1100'), ...t.filter((l) => l.id !== 'l1100')] : t) });
  const r = await buscarTudo(api.montar);
  const ids = Array.from(r.data, (l) => l.id);
  assert.equal(new Set(ids).size, 1147);
  assert.ok(ids.includes('l1100'), 'o lançamento que mudou de data continua na lista');
  assert.equal(ids[0], 'l1100', 'e na ordem nova');
  assert.equal(api.pedidos.length, 4);
});

test('tabela que não para de mexer: no máximo três voltas, e fica com a última (sem erro, sem laço)', async () => {
  let k = 0;
  const api = apiDeMentira(linhas(1147), { mexer: (n, t) => [{ id: 'nova' + ++k, n: -k }, ...t] });
  const r = await buscarTudo(api.montar);
  assert.equal(r.error, null);
  assert.equal(api.pedidos.length, 6, 'três voltas de duas páginas');
  assert.ok(r.data.length >= 1147);
});

test('nada mudou: duas páginas e pronto, sem volta a mais', async () => {
  const api = apiDeMentira(linhas(2500), { mexer: (n, t) => t });
  const r = await buscarTudo(api.montar);
  assert.equal(r.data.length, 2500);
  assert.equal(api.pedidos.length, 3);
});

test('página que só traz linha repetida não prende a busca num laço', async () => {
  let n = 0;
  const montar = () => ({ range() { n++; return Promise.resolve({ data: linhas(1000), error: null, count: 5000 }); } });
  const r = await buscarTudo(montar);
  assert.equal(r.data.length, 1000);
  assert.equal(n, 2, 'a segunda página não trouxe nada de novo: para');
});

test('servidor que ignora a página e manda tudo de uma vez: um pedido só, sem laço', async () => {
  let n = 0;
  const montar = () => ({ range() { n++; return Promise.resolve({ data: linhas(1147), error: null, count: null }); } });
  const r = await buscarTudo(montar);
  assert.equal(r.data.length, 1147);
  assert.equal(n, 1);
});

test('"depois do fim" (PGRST103) numa página seguinte não é falha: busca de novo e fica com a tabela como ficou', async () => {
  // a contagem dizia 1147, mas antes da segunda página a tabela "encolheu" pra mil: a API responde PGRST103
  let n = 0;
  const montar = () => ({
    range(de) {
      n++;
      if (n === 1) return Promise.resolve({ data: linhas(1000), error: null, count: 1147 });
      if (de > 0) return Promise.resolve({ data: null, error: { code: 'PGRST103', message: 'Requested range not satisfiable' }, count: null });
      return Promise.resolve({ data: linhas(1000), error: null, count: 1000 });
    },
  });
  const r = await buscarTudo(montar);
  assert.equal(r.error, null);
  assert.equal(r.data.length, 1000);
  assert.equal(n, 3, 'primeira página, o "depois do fim", e a volta que confirma as mil');
});

test('a carga do app usa buscarTudo nas tabelas que crescem, com ordem que termina no id', () => {
  const carga = source.slice(source.indexOf('const loadAll = useCallback'), source.indexOf('firstError = [cx, cl, sv'));
  for (const tabela of ['clientes', 'servicos', 'financeiro', 'pessoais']) {
    const linha = carga.split('\n').find((l) => l.includes(`db.from("${tabela}")`) && !l.trim().startsWith('//'));
    assert.ok(linha, `a carga consulta ${tabela}`);
    assert.match(linha, /buscarTudo\(\(\) => db\.from\(/, `${tabela} vem por buscarTudo`);
    assert.match(linha, /count: "exact"/, `${tabela} pede a contagem`);
    assert.match(linha, /\.order\("id", \{ ascending: true \}\)\)\s*,?\s*$/, `${tabela} termina a ordem no id`);
  }
  const historico = carga.split('\n').find((l) => l.includes('db.from("agenda")') && l.includes('.neq("status", "planejado")'));
  assert.match(historico, /buscarTudo\(/, 'agenda fora do planejado vem por buscarTudo');
  // A agenda planejada continua direta: são dezenas de linhas e ela tem que ser uma lista só, nunca página.
  const planejada = carga.split('\n').find((l) => l.includes('db.from("agenda")') && l.includes('.eq("status", "planejado")'));
  assert.doesNotMatch(planejada, /buscarTudo\(/);
});

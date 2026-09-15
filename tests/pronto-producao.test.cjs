const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../nova.html'), 'utf8');
const source = html.match(/<script type="text\/plain" id="app-source">([\s\S]*?)<\/script>/)[1];
const helpers = source.slice(source.indexOf('function servicoPronto('), source.indexOf('function ProntidaoButton('));
const ctx = vm.createContext({});
vm.runInContext(helpers, ctx);

test('prontidão depende do estado físico estruturado, não de texto, material ou valor', () => {
  assert.equal(ctx.servicoPronto({status:'producao', proxima_acao:'PRONTO', materiais_necessarios:[]}), false);
  assert.equal(ctx.servicoPronto({status:'pronto', valor_orcamento:null}), true);
  for (const status of ['lead','orcamento','entregue','pago','perdido']) assert.equal(ctx.servicoPronto({status}), false);
});
test('dois prontos saem da carga e o terceiro continua em produção', () => {
  const services = [{status:'pronto'}, {status:'pronto'}, {status:'producao'}];
  assert.equal(services.filter(ctx.servicoPronto).length, 2);
  assert.equal(services.filter(ctx.ocupaCapacidade).length, 1);
  assert.equal(ctx.ocupaCapacidade({status:'agendado'}), true);
});
function database(response) {
  const calls = [];
  const query = {
    update(patch) { calls.push(['update', patch]); return this; },
    eq(...args) { calls.push(['eq', ...args]); return this; },
    select(...args) { calls.push(['select', ...args]); return this; },
    async single() { return response; }
  };
  return { calls, from(table) { calls.push(['from', table]); return query; } };
}
test('marcar pronto escreve só status/timestamp e exige versão atual + readback', async () => {
  const db = database({data:{id:'s1',status:'pronto'}});
  await ctx.marcarServicoPronto(db, {id:'s1',status:'producao',atualizado_em:'versao-lida'});
  assert.deepEqual(db.calls.filter(x=>x[0]==='from'), [['from','servicos']]);
  assert.deepEqual(Object.keys(db.calls.find(x=>x[0]==='update')[1]).sort(), ['atualizado_em','status']);
  assert.deepEqual(db.calls.filter(x=>x[0]==='eq'), [['eq','id','s1'],['eq','status','producao'],['eq','atualizado_em','versao-lida']]);
  assert.ok(db.calls.some(x=>x[0]==='select'));
});
test('não declara sucesso em conflito/erro/readback ausente e não regrava pronto', async () => {
  await assert.rejects(ctx.marcarServicoPronto(database({error:new Error('conflito')}), {id:'s1',status:'producao'}), /conflito/);
  await assert.rejects(ctx.marcarServicoPronto(database({data:null}), {id:'s1',status:'producao'}), /não confirmada/);
  const db = database({});
  await assert.rejects(ctx.marcarServicoPronto(db, {id:'s1',status:'pronto'}), /Somente/);
  assert.equal(db.calls.length, 0);
});
test('app completo compila com os mesmos presets Babel da publicação', () => {
  assert.ok(process.env.BAHIA_BABEL_PATH, 'Defina BAHIA_BABEL_PATH para o Babel standalone usado pelo app');
  const Babel = require(process.env.BAHIA_BABEL_PATH);
  const output = Babel.transform(source, {presets:[['react',{runtime:'classic'}], 'typescript'],filename:'app.tsx'}).code;
  new vm.Script(output);
});

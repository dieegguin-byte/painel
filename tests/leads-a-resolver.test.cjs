// LEADS A RESOLVER (Diego, 13/11/2026). A auditoria grava uma linha por lead em avisos_operacionais (dominio "lead",
// referencia_id = serviço) e o Painel lista só as que ainda são lead/orçamento. Estes testes rodam o leadsAResolver e o
// parseResumoManha de verdade (tirados do nova.html) e conferem a ligação no Painel. Nomes e ids são fictícios.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'nova.html'), 'utf8');
const source = html.match(/<script type="text\/plain" id="app-source">([\s\S]*?)<\/script>/)[1];

function pegarFuncao(nome) {
  const inicio = source.indexOf(`function ${nome}(`);
  assert.ok(inicio > 0, `${nome} sumiu do nova.html`);
  // começa na chave do corpo, depois dos parâmetros (que podem ter { } de desestruturação)
  let i = source.indexOf(') {', inicio) + 2, nivel = 0;
  for (; i < source.length; i++) {
    if (source[i] === '{') nivel++;
    else if (source[i] === '}' && --nivel === 0) break;
  }
  return source.slice(inicio, i + 1);
}
function pegarConst(nome) {
  const m = source.match(new RegExp(`const ${nome} = [^\\n]*;`));
  assert.ok(m, `${nome} sumiu do nova.html`);
  return m[0];
}
const ctx = vm.createContext({});
vm.runInContext([pegarConst('DOMINIO_LEAD'), pegarConst('LEAD_STATUS_ABERTO'), pegarFuncao('leadsAResolver'), pegarFuncao('parseResumoManha'), pegarFuncao('cronogramaDiaLocal'), pegarFuncao('tempoNaLista')].join('\n') + '\nthis.leadsAResolver = leadsAResolver; this.parseResumoManha = parseResumoManha; this.tempoNaLista = tempoNaLista;', ctx);
// O vm tem outro Array: passa por JSON pra comparar com deepEqual.
const leadsAResolver = (...a) => JSON.parse(JSON.stringify(ctx.leadsAResolver(...a)));
const card = (id, servico_id) => ({ id, servico_id, status: 'planejado' });
const { parseResumoManha, tempoNaLista } = ctx;

const svc = (id, status, extra = {}) => ({ id, status, clientes: { nome: 'Fulana ' + id }, ...extra });
const lead = (id, ref, extra = {}) => ({ id, dominio: 'lead', aviso: 'Resumo ' + id, prioridade: 'media', ativo: true, referencia_id: ref, criado_em: '2026-11-13T05:30:00Z', ...extra });

test('só entra linha de lead cujo serviço ainda é lead ou orçamento', () => {
  const services = [svc('s1', 'lead'), svc('s2', 'orcamento'), svc('s3', 'agendado'), svc('s4', 'perdido'), svc('s5', null)];
  const avisos = [lead('a1', 's1'), lead('a2', 's2'), lead('a3', 's3'), lead('a4', 's4'), lead('a5', 's5'), lead('a6', 'nao-existe'),
    { ...lead('a7', 's1'), dominio: 'resumo_manha' }, lead('a8', 's2', { ativo: false }), lead('a9', null)];
  const ids = leadsAResolver(avisos, services).map((l) => l.aviso.id);
  assert.deepEqual(ids.sort(), ['a1', 'a2', 'a5'], 'agendado e perdido saem sozinhos; serviço sem status conta como lead');
});

test('lead que ganhou card planejado sai sozinho; card cancelado, ele volta', () => {
  const services = [svc('s1', 'lead'), svc('s2', 'orcamento')];
  const avisos = [lead('a1', 's1'), lead('a2', 's2')];
  assert.deepEqual(leadsAResolver(avisos, services, [card('c1', 's1'), card('c2', null)]).map((l) => l.aviso.id), ['a2'], 'quem tem data é card, não lista');
  assert.deepEqual(leadsAResolver(avisos, services, []).map((l) => l.aviso.id).sort(), ['a1', 'a2']);
});

test('cliente esperando vem primeiro, depois o mais antigo na lista', () => {
  const services = [svc('s1', 'lead'), svc('s2', 'lead'), svc('s3', 'orcamento')];
  const avisos = [
    lead('a1', 's1', { criado_em: '2026-11-10T05:30:00Z' }),
    lead('a2', 's2', { criado_em: '2026-11-12T05:30:00Z', prioridade: 'alta' }),
    lead('a3', 's3', { criado_em: '2026-11-09T05:30:00Z' }),
  ];
  assert.deepEqual(leadsAResolver(avisos, services).map((l) => l.aviso.id), ['a2', 'a3', 'a1']);
});

test('duas linhas ativas pro mesmo serviço viram uma só, a mais nova', () => {
  const services = [svc('s1', 'lead')];
  const avisos = [lead('velha', 's1', { criado_em: '2026-11-10T05:30:00Z' }), lead('nova', 's1', { criado_em: '2026-11-12T05:30:00Z' })];
  assert.deepEqual(leadsAResolver(avisos, services).map((l) => l.aviso.id), ['nova']);
});

test('lista vazia ou sem dados não quebra', () => {
  assert.deepEqual(leadsAResolver(null, null), []);
  assert.deepEqual(leadsAResolver([], [svc('s1', 'lead')]), []);
});

test('resumo da manhã: linha com dois clientes não mostra código cru e guarda os dois', () => {
  const { blocos } = parseResumoManha('Prioridades de hoje:\n- Fulana espera o valor, e o Fulano perguntou do linho {cliente:aaa-1} {cliente:bbb-2}\n- Só um cliente {cliente:ccc-3}\n- Sem cliente');
  const [dois, um, nenhum] = blocos[0].itens;
  assert.equal(dois.texto, 'Fulana espera o valor, e o Fulano perguntou do linho');
  assert.deepEqual(Array.from(dois.clienteIds), ['aaa-1', 'bbb-2']);
  assert.equal(dois.clienteId, 'aaa-1');
  assert.equal(um.texto, 'Só um cliente');
  assert.equal(um.clienteId, 'ccc-3');
  assert.equal(nenhum.clienteId, null);
  assert.doesNotMatch(JSON.stringify(blocos), /\{cliente:/);
});

test('"desde quando" conta o dia de Brasília e vem pronto', () => {
  assert.equal(tempoNaLista('2026-11-13T05:20:00+00:00', '2026-11-13'), 'entrou hoje');
  assert.equal(tempoNaLista('2026-11-12T05:20:00+00:00', '2026-11-13'), 'na lista desde ontem');
  assert.equal(tempoNaLista('2026-11-10T05:20:00+00:00', '2026-11-13'), 'na lista há 3 dias');
  // 22h de Brasília do dia 12 já é dia 13 em UTC: continua contando como dia 12.
  assert.equal(tempoNaLista('2026-11-13T01:00:00+00:00', '2026-11-13'), 'na lista desde ontem');
  assert.equal(tempoNaLista(null, '2026-11-13'), '');
  assert.equal(tempoNaLista('2026-11-14T05:20:00+00:00', '2026-11-13'), 'entrou hoje', 'relógio adiantado não vira número negativo');
});

test('o Painel mostra o card fechado antes das Propostas, com os três botões', () => {
  assert.match(source, /<LeadsAResolverCard avisos=\{avisos\} services=\{services\} agendaPlanejada=\{agendaPlanejada\} finances=\{finances\}[^\n]*\/>\n\s*<PropostasCard /);
  const card = pegarFuncao('LeadsAResolverCard');
  assert.match(card, /<CardRecolhivel className="content-card leads-resolver"/, 'fechado como os outros cards do Painel');
  assert.match(card, />WhatsApp</);
  assert.match(card, />✓ Concluir</);
  assert.match(card, />✖ Cancelar</);
  // Concluir na esquerda, WhatsApp no meio, Cancelar na direita.
  assert.ok(card.indexOf('>✓ Concluir<') < card.indexOf('>WhatsApp<') && card.indexOf('>WhatsApp<') < card.indexOf('>✖ Cancelar<'));
  const sair = card.slice(card.indexOf('const sair = async'), card.indexOf('const desfazer = async'));
  const desfazer = card.slice(card.indexOf('const desfazer = async'), card.indexOf('const saiu = new Set'));
  assert.doesNotMatch(sair, /confirm\(/, 'um toque por ação: Concluir e Cancelar não perguntam');
  assert.match(desfazer, /window\.confirm\(/, 'todo Desfazer do app pergunta antes (14/10/2026)');
  assert.match(card, /const viraPerdido = tipo === "cancelar" && !\(pago > 0\)/, 'Cancelar não põe perdido em serviço com dinheiro pago');
  assert.match(sair, /status: "perdido"/);
  // Formato que a auditoria já confere pro encerramento (passos-1l-1v, ponto 6): texto antigo embaixo, "antes" no historico.
  assert.match(sair, /`ENCERRADO pelo Diego \$\{ddmm\} \(lista de leads\), ficha fica\$\{a\.proxima_acao \? "\\n" \+ a\.proxima_acao : ""\}`/);
  assert.match(sair, /antes: status \$\{a\.status\}/);
  // A auditoria acha o toque pelo id do serviço, nunca pelo nome.
  assert.match(sair, /const marca = \(id\) => `servico \$\{id\} · aviso /);
  assert.doesNotMatch(card, /from\("agenda"\)/, 'a lista não mexe em card: lead com card nem aparece nela');
  assert.doesNotMatch(card, /\.delete\(/, 'cancelar, nunca apagar');
  assert.match(card, /onFechar=\{\(\) => setSaidas\(\[\]\)\}/, 'as faixas de Desfazer somem quando a lista fecha');
  assert.match(source, /from\("avisos_operacionais"\)\.select\("[^"]*criado_em[^"]*"\)\.eq\("ativo", true\)/, 'o "desde" precisa do criado_em');
});

test('a migração só acrescenta "lead" à trava do dominio', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migracoes', '20261113120000_avisos_lead.sql'), 'utf8');
  for (const d of ['agenda', 'financeiro', 'producao', 'compras', 'geral', 'encaixe_rota', 'resumo_manha', 'lead']) assert.match(sql, new RegExp(`'${d}'`));
  assert.doesNotMatch(sql, /drop table|drop column|delete from|truncate/i);
});

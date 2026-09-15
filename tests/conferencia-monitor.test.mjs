import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// PostgreSQL real em memória. Nunca aceita URL/conexão de banco externo.
// Docs: https://pglite.dev/docs/api
// https://supabase.com/docs/guides/database/postgres/row-level-security
// Carrega a migração final do próprio repositório para reproduzir o pacote entregue.
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
const C = '10000000-0000-4000-8000-000000000003';
const D = '10000000-0000-4000-8000-000000000004';
const CLIENT_A = '20000000-0000-4000-8000-000000000001';
const CLIENT_B = '20000000-0000-4000-8000-000000000002';
const BUSINESS = ['clientes', 'servicos', 'agenda', 'financeiro', 'pendencias', 'avisos_operacionais', 'caixa_entrada'];
let pg;

async function schemaFile() {
  return fileURLToPath(new URL('../migracoes/20260915015739_conferencia_monitor_pronto.sql', import.meta.url));
}

const fixture = [
  'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;',
  'CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;',
  "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;",
  "CREATE FUNCTION public.usuario_autorizado() RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER AS $$ SELECT coalesce(auth.uid() = '" + USER + "'::uuid, false) $$;",
  'CREATE TABLE public.clientes (id uuid PRIMARY KEY, nome text NOT NULL);',
  'CREATE TABLE public.servicos (id uuid PRIMARY KEY, cliente_id uuid, titulo text, status text, proxima_acao text, profissional text, responsavel text, loja_material text, prazo date, data_entrega_material date, materiais_necessarios jsonb);',
  'CREATE TABLE public.agenda (id uuid PRIMARY KEY, servico_id uuid, titulo text, data date, hora time, status text);',
  ...['financeiro', 'pendencias', 'avisos_operacionais', 'caixa_entrada'].map((t) => 'CREATE TABLE public.' + t + ' (id integer PRIMARY KEY, dados jsonb NOT NULL);'),
  'ALTER TABLE public.servicos ENABLE ROW LEVEL SECURITY; ALTER TABLE public.agenda ENABLE ROW LEVEL SECURITY;',
  'GRANT SELECT ON public.servicos, public.agenda TO authenticated;',
  "CREATE POLICY servicos_fixture_read ON public.servicos FOR SELECT TO authenticated USING (public.usuario_autorizado() AND id::text <> coalesce(current_setting('test.hidden_service', true), ''));",
  'CREATE POLICY agenda_fixture_read ON public.agenda FOR SELECT TO authenticated USING (public.usuario_autorizado());',
  "CREATE FUNCTION public.test_reject_business_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Unexpected business mutation'; END $$;",
  "CREATE FUNCTION public.test_reject_monitor_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected monitor failure'; END $$;",
].join('\n');

async function asRole(role, subject, callback) {
  assert.ok(['anon', 'authenticated', 'service_role'].includes(role));
  await pg.exec('SET ROLE ' + role);
  try {
    await pg.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [subject || '']);
    return await callback();
  } finally {
    await pg.exec('RESET ROLE');
    await pg.query("SELECT set_config('request.jwt.claim.sub', '', false)");
  }
}
const worker = () => pg.query('SELECT private.conferencia_executar()');
const monitor = async () => (await pg.query('SELECT public.conferencia_monitor() AS payload')).rows[0].payload;
const appMonitor = () => asRole('authenticated', USER, monitor);
const consultarServico = async (id = A) => (await pg.query('SELECT public.conferencia_consultar_servico($1::uuid) AS payload', [id])).rows[0].payload;
const appConsultar = (id = A) => asRole('authenticated', USER, () => consultarServico(id));
async function rows(table) {
  assert.ok([...BUSINESS, 'conferencia_ocorrencias', 'conferencia_estado'].includes(table));
  return (await pg.query('SELECT to_jsonb(t) AS row FROM public.' + table + ' t ORDER BY to_jsonb(t)::text')).rows.map((r) => r.row);
}
async function technicalSnapshot() {
  return { ocorrencias: await rows('conferencia_ocorrencias'), estado: await rows('conferencia_estado') };
}
async function businessSnapshot() {
  const result = {};
  for (const name of BUSINESS) result[name] = await rows(name);
  return result;
}
const denied = (callback) => assert.rejects(callback, (error) => error.code === '42501');

describe('Conferência automática — PostgreSQL local', { concurrency: false }, () => {
  before(async () => {
    pg = await PGlite.create();
    await pg.exec(fixture);
    const path = await schemaFile();
    await pg.exec(await readFile(path, 'utf8'));
    console.log('SQL sob teste: ' + path);
    console.log((await pg.query('SELECT version() AS version')).rows[0].version);
  });
  after(async () => { if (pg) await pg.close(); });
  beforeEach(async () => {
    await pg.exec([
      'RESET ROLE;',
      'DROP TRIGGER IF EXISTS test_failure ON public.conferencia_estado;',
      'DROP TRIGGER IF EXISTS test_failure ON public.conferencia_ocorrencias;',
      ...BUSINESS.map((t) => 'DROP TRIGGER IF EXISTS test_guard ON public.' + t + ';'),
      "SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('test.hidden_service', '', false);",
      'TRUNCATE public.conferencia_ocorrencias, public.conferencia_estado, ' + BUSINESS.map((t) => 'public.' + t).join(', ') + ';',
      'INSERT INTO public.conferencia_estado (id) VALUES (1);',
    ].join('\n'));
    await pg.query('INSERT INTO public.clientes VALUES ($1,$2),($3,$4)', [CLIENT_A, 'Cliente fictício A', CLIENT_B, 'Cliente fictício B']);
    const services = [
      [A, CLIENT_A, 'Sofá fictício', 'pronto', 'Combinar entrega', '2026-09-10'],
      [B, CLIENT_B, 'Cadeiras fictícias', 'pronto', null, null],
      [C, CLIENT_A, 'Poltrona fictícia', 'producao', 'Texto diz pronto, mas status não confirma', '2026-09-09'],
      [D, CLIENT_B, 'Cabeceira fictícia', 'lead', 'Texto diz entregue e pago', null],
    ];
    for (const service of services) await pg.query("INSERT INTO public.servicos (id,cliente_id,titulo,status,proxima_acao,prazo,materiais_necessarios) VALUES ($1,$2,$3,$4,$5,$6,'[]')", service);
    await pg.query("INSERT INTO public.agenda VALUES ('30000000-0000-4000-8000-000000000001',$1,'Visita fictícia','2026-09-10','09:00','planejado'),('30000000-0000-4000-8000-000000000002',$1,'Entrega cancelada','2026-09-11','10:00','cancelado')", [A]);
    for (const table of ['financeiro', 'pendencias', 'avisos_operacionais', 'caixa_entrada']) await pg.query('INSERT INTO public.' + table + ' VALUES (1,$1)', [{ ficticio: true, status: 'preservar' }]);
  });

  test('worker e RPC são INVOKER; RLS está ativa nas duas tabelas técnicas', async () => {
    const functions = (await pg.query("SELECT n.nspname,p.proname,p.prosecdef,p.provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='private' AND p.proname='conferencia_executar') OR (n.nspname='public' AND p.proname='conferencia_monitor')")).rows;
    assert.equal(functions.length, 2);
    assert.ok(functions.every((row) => row.prosecdef === false));
    assert.equal(functions.find((row) => row.proname === 'conferencia_monitor').provolatile, 's');
    const tables = (await pg.query("SELECT relrowsecurity FROM pg_class WHERE oid IN ('public.conferencia_ocorrencias'::regclass, 'public.conferencia_estado'::regclass)")).rows;
    assert.ok(tables.every((row) => row.relrowsecurity));
  });

  test('antes da primeira execução não apresenta conferência completa nem horário fictício', async () => {
    const result = await appMonitor();
    assert.equal(result.ok, true);
    assert.equal(result.ultima_conclusao_em, null);
    assert.equal(result.completo, false);
    assert.equal(result.total, 0);
    assert.deepEqual(result.ocorrencias, []);
  });

  test('cria exatamente duas ocorrências usando somente o status oficial pronto', async () => {
    await worker();
    const result = await appMonitor();
    assert.equal(result.total, 2);
    assert.equal(result.completo, true);
    assert.equal(result.regra.id, 'SERVICO_PRONTO');
    assert.deepEqual(result.ocorrencias.map((o) => o.servico_id).sort(), [A, B]);
    assert.ok(result.ocorrencias.every((o) => o.status === 'pronto'));
    const state = (await rows('conferencia_estado'))[0];
    assert.equal(state.ocorrencias_ativas, 2);
    assert.equal(state.execucoes, 1);
    assert.ok(state.ultima_conclusao_em);
  });

  test('repetir varredura não duplica ocorrências nem reinicia a primeira detecção', async () => {
    await worker();
    const first = await rows('conferencia_ocorrencias');
    await worker();
    const second = await rows('conferencia_ocorrencias');
    assert.equal(second.length, 2);
    for (const item of second) {
      const original = first.find((o) => o.servico_id === item.servico_id);
      assert.equal(item.detectada_em, original.detectada_em);
      assert.ok(item.confirmada_em >= original.confirmada_em);
    }
    assert.equal((await rows('conferencia_estado'))[0].execucoes, 2);
  });

  test('sair de pronto encerra apenas ocorrência técnica, sem reescrever o serviço', async () => {
    await worker();
    await pg.query("UPDATE public.servicos SET status='entregue',proxima_acao='Registro mantido pelo operador' WHERE id=$1", [A]);
    const original = await businessSnapshot();
    await worker();
    assert.deepEqual(await businessSnapshot(), original);
    const item = (await rows('conferencia_ocorrencias')).find((o) => o.servico_id === A);
    assert.equal(item.ativa, false);
    assert.ok(item.encerrada_em);
    assert.equal((await appMonitor()).total, 1);
  });

  test('retorno a pronto reativa a mesma chave técnica, sem acumular nova linha', async () => {
    await worker();
    await pg.query("UPDATE public.servicos SET status='producao' WHERE id=$1", [A]);
    await worker();
    const closed = (await rows('conferencia_ocorrencias')).find((o) => o.servico_id === A);
    await pg.query("UPDATE public.servicos SET status='pronto' WHERE id=$1", [A]);
    await worker();
    const result = await rows('conferencia_ocorrencias');
    assert.equal(result.length, 2);
    const reopened = result.find((o) => o.servico_id === A);
    assert.equal(reopened.ativa, true);
    assert.equal(reopened.encerrada_em, null);
    assert.ok(reopened.detectada_em >= closed.encerrada_em);
  });

  test('remoção de um serviço não é bloqueada e encerra seu registro técnico', async () => {
    await worker();
    await pg.query('DELETE FROM public.servicos WHERE id=$1', [A]);
    await worker();
    assert.equal((await rows('conferencia_ocorrencias')).find((o) => o.servico_id === A).ativa, false);
    assert.equal((await appMonitor()).total, 1);
  });

  test('nenhuma tabela de negócio sofre tentativa de escrita durante worker e consulta', async () => {
    const original = await businessSnapshot();
    await pg.exec(BUSINESS.map((t) => 'CREATE TRIGGER test_guard BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.' + t + ' FOR EACH STATEMENT EXECUTE FUNCTION public.test_reject_business_write();').join('\n'));
    await worker();
    await appMonitor();
    assert.deepEqual(await businessSnapshot(), original);
  });

  for (const role of ['anon', 'authenticated', 'service_role']) {
    test(role + ' não pode executar o worker privado', async () => {
      await asRole(role, USER, () => denied(worker));
      assert.equal((await rows('conferencia_estado'))[0].execucoes, 0);
    });
  }

  test('RLS permite ler tabelas técnicas somente ao usuário autorizado', async () => {
    await worker();
    await asRole('authenticated', USER, async () => {
      assert.equal((await rows('conferencia_ocorrencias')).length, 2);
      assert.equal((await rows('conferencia_estado')).length, 1);
    });
    for (const subject of ['', OTHER_USER]) await asRole('authenticated', subject, async () => {
      assert.deepEqual(await rows('conferencia_ocorrencias'), []);
      assert.deepEqual(await rows('conferencia_estado'), []);
    });
    await asRole('anon', '', () => denied(() => rows('conferencia_ocorrencias')));
  });

  test('app autorizado não consegue inserir, atualizar ou apagar registros técnicos', async () => {
    await worker();
    const original = await technicalSnapshot();
    const attempts = [
      "INSERT INTO public.conferencia_ocorrencias VALUES ('SERVICO_PRONTO','" + C + "',true,now(),now(),NULL,1)",
      'UPDATE public.conferencia_ocorrencias SET ativa=false,encerrada_em=now()',
      'DELETE FROM public.conferencia_ocorrencias',
      'INSERT INTO public.conferencia_estado (id) VALUES (1)',
      'UPDATE public.conferencia_estado SET execucoes=999',
      'DELETE FROM public.conferencia_estado',
    ];
    await asRole('authenticated', USER, async () => {
      for (const sql of attempts) await denied(() => pg.query(sql));
    });
    assert.deepEqual(await technicalSnapshot(), original);
  });

  test('RPC rejeita anon e authenticated sem identidade autorizada', async () => {
    await worker();
    await asRole('anon', '', () => denied(monitor));
    await asRole('authenticated', '', () => denied(monitor));
    await asRole('authenticated', OTHER_USER, () => denied(monitor));
  });

  test('RPC usa título, cliente e status atuais antes da próxima varredura', async () => {
    await worker();
    await pg.query('UPDATE public.servicos SET titulo=$2,cliente_id=$3 WHERE id=$1', [A, 'Título corrigido pelo operador', CLIENT_B]);
    await pg.query("UPDATE public.servicos SET status='entregue' WHERE id=$1", [B]);
    const result = await appMonitor();
    assert.equal(result.total, 1);
    assert.equal(result.ocorrencias[0].titulo, 'Título corrigido pelo operador');
    assert.equal(result.ocorrencias[0].cliente_id, CLIENT_B);
    assert.equal(result.ocorrencias[0].servico_id, A);
    assert.equal((await rows('conferencia_ocorrencias')).filter((o) => o.ativa).length, 2, 'consulta não deve fechar ocorrência');
  });

  test('RPC e SELECT direto respeitam a RLS atual do serviço de origem', async () => {
    await worker();
    await pg.query("SELECT set_config('test.hidden_service',$1,false)", [A]);
    await asRole('authenticated', USER, async () => {
      assert.deepEqual((await rows('conferencia_ocorrencias')).map((o) => o.servico_id), [B]);
      const result = await monitor();
      assert.deepEqual(result.ocorrencias.map((o) => o.servico_id), [B]);
      assert.equal(result.total, 1);
    });
  });

  test('consulta não atualiza o heartbeat ou qualquer ocorrência técnica', async () => {
    await worker();
    const original = await technicalSnapshot();
    await appMonitor();
    await appMonitor();
    assert.deepEqual(await technicalSnapshot(), original);
  });

  test('falha na ocorrência reverte execução e preserva último heartbeat concluído', async () => {
    await worker();
    const original = await technicalSnapshot();
    await pg.query("UPDATE public.servicos SET status='pronto' WHERE id=$1", [C]);
    await pg.exec('CREATE TRIGGER test_failure BEFORE INSERT OR UPDATE ON public.conferencia_ocorrencias FOR EACH ROW EXECUTE FUNCTION public.test_reject_monitor_write()');
    await assert.rejects(worker, /Injected monitor failure/);
    assert.deepEqual(await technicalSnapshot(), original);
  });

  test('falha ao salvar heartbeat reverte inserções e encerramentos técnicos anteriores', async () => {
    await worker();
    const original = await technicalSnapshot();
    await pg.query("UPDATE public.servicos SET status='pronto' WHERE id=$1", [C]);
    await pg.query("UPDATE public.servicos SET status='entregue' WHERE id=$1", [A]);
    await pg.exec('CREATE TRIGGER test_failure BEFORE UPDATE ON public.conferencia_estado FOR EACH ROW EXECUTE FUNCTION public.test_reject_monitor_write()');
    await assert.rejects(worker, /Injected monitor failure/);
    assert.deepEqual(await technicalSnapshot(), original);
  });

  test('estado técnico ausente falha sem persistir ocorrências pela metade', async () => {
    await pg.query('DELETE FROM public.conferencia_estado');
    await assert.rejects(worker, (error) => error.code === '55000');
    assert.deepEqual(await rows('conferencia_ocorrencias'), []);
    assert.deepEqual(await rows('conferencia_estado'), []);
  });

  test('limite de 500 informa total real e não marca resposta truncada como completa', async () => {
    await pg.query("INSERT INTO public.servicos (id,cliente_id,titulo,status) SELECT ('40000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,$1::uuid,'Serviço fictício ' || n,'pronto' FROM generate_series(1,499) n", [CLIENT_A]);
    await worker();
    const result = await appMonitor();
    assert.equal(result.total, 501);
    assert.equal(result.ocorrencias.length, 500);
    assert.equal(result.completo, false);
  });

  test('consulta por serviço é INVOKER e entrega fatos atuais com somente agenda planejada vinculada', async () => {
    const metadata = (await pg.query("SELECT prosecdef,provolatile FROM pg_proc WHERE oid='public.conferencia_consultar_servico(uuid)'::regprocedure")).rows[0];
    assert.equal(metadata.prosecdef, false);
    assert.equal(metadata.provolatile, 's');
    const result = await appConsultar();
    assert.equal(result.ok, true);
    assert.equal(result.modo, 'regras');
    assert.equal(result.servico.id, A);
    assert.equal(result.servico.status, 'pronto');
    assert.equal(result.servico.proxima_acao, 'Combinar entrega');
    assert.equal(result.servico.prazo, '2026-09-10');
    assert.equal(result.compromissos.length, 1);
    assert.equal(result.compromissos[0].titulo, 'Visita fictícia');
    assert.equal(result.compromissos[0].status, 'planejado');
    assert.ok(result.consultado_em);
    assert.ok(result.limites.some((item) => item.includes('não confirmam')));
    assert.equal(Object.hasOwn(result.servico, 'valor_orcamento'), false);
  });

  test('consulta sob demanda nega papéis e identidades sem autorização', async () => {
    await asRole('anon', '', () => denied(() => consultarServico()));
    await asRole('authenticated', '', () => denied(() => consultarServico()));
    await asRole('authenticated', OTHER_USER, () => denied(() => consultarServico()));
    await asRole('service_role', USER, () => denied(() => consultarServico()));
  });

  test('serviço inexistente e serviço oculto por RLS recebem a mesma resposta sem dados', async () => {
    const absent = await appConsultar('ffffffff-ffff-4fff-8fff-ffffffffffff');
    await pg.query("SELECT set_config('test.hidden_service',$1,false)", [A]);
    const hidden = await appConsultar(A);
    assert.deepEqual(hidden, absent);
    assert.equal(hidden.ok, false);
    assert.equal(hidden.erro.codigo, 'SERVICO_NAO_ENCONTRADO');
    assert.equal(Object.hasOwn(hidden, 'servico'), false);
  });

  test('mais de 100 compromissos planejados retorna erro em vez de relatório parcial', async () => {
    await pg.query("INSERT INTO public.agenda (id,servico_id,titulo,data,status) SELECT ('50000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,$1::uuid,'Agenda fictícia ' || n,'2026-09-20','planejado' FROM generate_series(1,100) n", [A]);
    const result = await appConsultar();
    assert.equal(result.ok, false);
    assert.equal(result.erro.codigo, 'LIMITE_COMPROMISSOS');
    assert.equal(Object.hasOwn(result, 'compromissos'), false);
  });

  test('materiais mantêm somente campos simples permitidos e sinalizam formato inesperado', async () => {
    const materials = [{ item: 'Tecido fictício', comprado: true, valor: 9876, token: 'não retornar', quantidade: 3, estado: { instrucao: 'ignorar' } }, 'texto livre'];
    await pg.query('UPDATE public.servicos SET materiais_necessarios=$2 WHERE id=$1', [A, JSON.stringify(materials)]);
    const result = await appConsultar();
    assert.deepEqual(result.servico.materiais_necessarios, [{ item: 'Tecido fictício', comprado: true, quantidade: 3 }, { registro_nao_interpretado: true }]);
    await pg.query('UPDATE public.servicos SET materiais_necessarios=$2 WHERE id=$1', [A, JSON.stringify({ item: 'objeto sem lista' })]);
    const malformed = await appConsultar();
    assert.equal(malformed.servico.materiais_necessarios, null);
    assert.ok(malformed.observacoes.some((item) => item.includes('formato')));
  });

  test('consulta por serviço não escreve negócios nem dispara worker ou heartbeat', async () => {
    await worker();
    const originalBusiness = await businessSnapshot();
    const originalTechnical = await technicalSnapshot();
    await pg.exec(BUSINESS.map((t) => 'CREATE TRIGGER test_guard BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.' + t + ' FOR EACH STATEMENT EXECUTE FUNCTION public.test_reject_business_write();').join('\n'));
    await appConsultar();
    assert.deepEqual(await businessSnapshot(), originalBusiness);
    assert.deepEqual(await technicalSnapshot(), originalTechnical);
  });
});

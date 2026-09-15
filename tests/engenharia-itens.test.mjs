import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, describe, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// PostgreSQL em memoria. Este arquivo nunca recebe URL, credencial ou conexao externa.
const migrationUrl = new URL('../migracoes/20260915153026_engenharia_itens_cronograma.sql', import.meta.url);
const rollbackUrl = new URL('../migracoes/rollback/engenharia_itens.sql', import.meta.url);
const migration = await readFile(migrationUrl, 'utf8');
const rollback = await readFile(rollbackUrl, 'utf8');
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RECADO = 'https://docs.google.com/document/d/recado-ficticio/edit';
const RETORNO = 'https://drive.google.com/file/d/retorno-ficticio/view';
const VALIDACAO = 'https://docs.google.com/document/d/validacao-ficticia/edit';
const STAMP = '2026-09-15T12:00:00.000Z';
const COLUMNS = [
  'item_id', 'descricao', 'prioridade', 'fase_id', 'criado_em', 'enviado_em',
  'estado', 'recado_url', 'retorno_url', 'commit_hash', 'deploy_url',
  'readback_tecnico_em', 'validacao_classic_em', 'validacao_classic_url',
  'motivo_bloqueio', 'atualizado_em',
];
let pg, sequence;

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

async function insert(overrides = {}) {
  const item = { item_id: `TESTE-${++sequence}`, descricao: 'Pedido tecnico ficticio', recado_url: RECADO, ...overrides };
  const columns = Object.keys(item);
  assert.ok(columns.every((column) => COLUMNS.includes(column)));
  const values = columns.map((column) => item[column]);
  return (await pg.query(
    `INSERT INTO public.engenharia_itens (${columns.join(',')}) VALUES (${columns.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, values,
  )).rows[0];
}
const rows = async () => (await pg.query('SELECT to_jsonb(t) AS item FROM public.engenharia_itens t ORDER BY item_id')).rows.map((row) => row.item);
const denied = (callback) => assert.rejects(callback, (error) => error.code === '42501');
const invalid = (callback) => assert.rejects(callback, (error) => ['23514', '23502'].includes(error.code));
const complete = (overrides = {}) => ({
  estado: 'concluido', retorno_url: RETORNO, readback_tecnico_em: STAMP,
  validacao_classic_em: STAMP, validacao_classic_url: VALIDACAO, ...overrides,
});

describe('Cronograma de engenharia — PostgreSQL local', { concurrency: false }, () => {
  before(async () => {
    pg = await PGlite.create();
    await pg.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
      CREATE SCHEMA auth;
      GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      CREATE FUNCTION public.usuario_autorizado() RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER AS $$
        SELECT coalesce(auth.uid() = '${USER}'::uuid, false)
      $$;
      CREATE TABLE public.servicos (id integer PRIMARY KEY, status text NOT NULL);
      INSERT INTO public.servicos VALUES (1, 'pronto'), (2, 'producao');
      CREATE FUNCTION public.proibir_mudanca_negocio_teste() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Tabela de negocio nao deve ser alterada'; END;
      $$;
      CREATE TRIGGER guard_negocio BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.servicos
        FOR EACH STATEMENT EXECUTE FUNCTION public.proibir_mudanca_negocio_teste();
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
    `);
    await pg.exec(migration);
    console.log('SQL sob teste: ' + migrationUrl.pathname);
    console.log((await pg.query('SELECT version() AS version')).rows[0].version);
  });
  after(async () => { if (pg) await pg.close(); });
  beforeEach(async () => {
    await pg.exec('RESET ROLE');
    await pg.exec(migration);
    await pg.exec('TRUNCATE public.engenharia_itens');
    sequence = 0;
  });

  test('schema exato, defaults reais, RLS ativa e nenhuma ligacao com negocio', async () => {
    const columns = (await pg.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='engenharia_itens' ORDER BY ordinal_position")).rows;
    assert.deepEqual(columns.map((c) => c.column_name), COLUMNS);
    const row = await insert();
    assert.equal(row.estado, 'a_fazer');
    for (const field of ['prioridade', 'fase_id', 'enviado_em', 'retorno_url', 'readback_tecnico_em', 'validacao_classic_em']) assert.equal(row[field], null);
    assert.ok(row.criado_em && row.atualizado_em);
    assert.equal((await pg.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.engenharia_itens'::regclass")).rows[0].relrowsecurity, true);
    const policies = (await pg.query("SELECT cmd,roles,qual FROM pg_policies WHERE schemaname='public' AND tablename='engenharia_itens'")).rows;
    assert.equal(policies.length, 1);
    assert.equal(policies[0].cmd, 'SELECT');
    assert.match(policies[0].qual, /usuario_autorizado/);
    const extra = (await pg.query("SELECT (SELECT count(*) FROM pg_constraint WHERE conrelid='public.engenharia_itens'::regclass AND contype='f') AS fks, (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.engenharia_itens'::regclass AND NOT tgisinternal) AS triggers")).rows[0];
    assert.equal(Number(extra.fks), 0);
    assert.equal(Number(extra.triggers), 0);
    assert.deepEqual((await pg.query('SELECT * FROM public.servicos ORDER BY id')).rows, [{ id: 1, status: 'pronto' }, { id: 2, status: 'producao' }]);
  });

  test('somente authenticated autorizado le; outro usuario e JWT ausente nao veem linhas', async () => {
    await insert(complete());
    const expected = await rows();
    assert.deepEqual(await asRole('authenticated', USER, rows), expected);
    assert.deepEqual(await asRole('authenticated', OTHER, rows), []);
    assert.deepEqual(await asRole('authenticated', null, rows), []);
    await asRole('anon', USER, () => denied(rows));
  });

  test('authenticated nao escreve mesmo autorizado; revoga privilegios herdados por default', async () => {
    await insert({ item_id: 'EXISTENTE' });
    const original = await rows();
    await asRole('authenticated', USER, async () => {
      await denied(() => insert());
      await denied(() => pg.exec("UPDATE public.engenharia_itens SET descricao='Alterado' WHERE item_id='EXISTENTE'"));
      await denied(() => pg.exec("DELETE FROM public.engenharia_itens WHERE item_id='EXISTENTE'"));
      await denied(() => pg.exec('TRUNCATE public.engenharia_itens'));
    });
    assert.deepEqual(await rows(), original);
    const grants = (await pg.query("SELECT grantee,privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='engenharia_itens' AND grantee IN ('PUBLIC','anon','authenticated') ORDER BY grantee,privilege_type")).rows;
    assert.deepEqual(grants, [{ grantee: 'authenticated', privilege_type: 'SELECT' }]);
  });

  test('service_role pode manter os itens, mas continua sujeito aos gates', async () => {
    await asRole('service_role', null, async () => {
      const row = await insert({ item_id: 'SERVICE' });
      assert.equal(row.item_id, 'SERVICE');
      await pg.exec("UPDATE public.engenharia_itens SET estado='enviado_codex',enviado_em=now(),atualizado_em=now() WHERE item_id='SERVICE'");
      assert.equal((await rows())[0].estado, 'enviado_codex');
      await invalid(() => pg.exec("UPDATE public.engenharia_itens SET estado='concluido' WHERE item_id='SERVICE'"));
      await pg.exec("DELETE FROM public.engenharia_itens WHERE item_id='SERVICE'");
      assert.equal((await rows()).length, 0);
    });
  });

  test('valida ID, descricao, estados, prioridades, fases e carimbos obrigatorios', async () => {
    for (const estado of ['a_fazer', 'enviado_codex', 'em_execucao']) await insert({ estado });
    for (const prioridade of ['P0', 'P1', 'P2', 'P3', null]) await insert({ prioridade });
    for (const fase_id of ['monitor', 'financeiro', 'prazos', 'materiais', 'handoff', null]) await insert({ fase_id });
    for (const bad of [
      { item_id: '' }, { item_id: ' \n\t' }, { descricao: null }, { descricao: '\t ' },
      { prioridade: 'P4' }, { prioridade: 'p1' }, { fase_id: 'producao' },
      { estado: 'validado' }, { estado: null }, { criado_em: null }, { atualizado_em: null },
    ]) await invalid(() => insert(bad));
    await insert({ item_id: 'UNICO' });
    await assert.rejects(() => insert({ item_id: 'UNICO' }), (error) => error.code === '23505');
  });

  test('retorno e readback sao obrigatorios nos estados que afirmam essas evidencias', async () => {
    for (const estado of ['retorno_recebido', 'aguardando_validacao_classic', 'concluido']) {
      for (const retorno_url of [null, '', ' \t']) await invalid(() => insert(complete({ estado, retorno_url })));
    }
    await insert({ estado: 'retorno_recebido', retorno_url: RETORNO });
    for (const estado of ['aguardando_validacao_classic', 'concluido']) {
      await invalid(() => insert(complete({ estado, readback_tecnico_em: null })));
    }
    await insert({ estado: 'aguardando_validacao_classic', retorno_url: RETORNO, readback_tecnico_em: STAMP });
  });

  test('concluido exige validacao Classic com timestamp e URL validos, inclusive ao atualizar', async () => {
    for (const bad of [{ validacao_classic_em: null }, { validacao_classic_url: null }, { validacao_classic_url: '' }, { validacao_classic_url: ' ' }]) {
      await invalid(() => insert(complete(bad)));
    }
    await insert(complete({ item_id: 'VALIDADO' }));
    await invalid(() => pg.exec("UPDATE public.engenharia_itens SET retorno_url=NULL WHERE item_id='VALIDADO'"));
    await invalid(() => pg.exec("UPDATE public.engenharia_itens SET readback_tecnico_em=NULL WHERE item_id='VALIDADO'"));
    await invalid(() => pg.exec("UPDATE public.engenharia_itens SET validacao_classic_url=NULL WHERE item_id='VALIDADO'"));
    assert.equal((await rows())[0].estado, 'concluido');
  });

  test('bloqueio e decisao de negocio pendente exigem motivo preenchido', async () => {
    for (const estado of ['bloqueado', 'decisao_negocio_pendente']) {
      for (const motivo_bloqueio of [null, '', ' ', '\n\t']) await invalid(() => insert({ estado, motivo_bloqueio }));
      await insert({ estado, motivo_bloqueio: 'Aguardar decisao registrada pelo Classic.' });
    }
  });

  test('links de evidencia aceitam apenas HTTPS de Drive/Docs sem falsos dominios', async () => {
    for (const field of ['recado_url', 'retorno_url', 'validacao_classic_url']) {
      for (const url of [RECADO, RETORNO, VALIDACAO, 'https://docs.google.com/spreadsheets/d/fixture/edit?usp=sharing']) await insert({ [field]: url });
      for (const url of [
        '', ' ', 'https://docs.google.com/', 'http://docs.google.com/document/d/x',
        'javascript:alert(1)', '//docs.google.com/document/d/x',
        'https://docs.google.com.evil.example/document/d/x',
        'https://docs.google.com@evil.example/document/d/x',
        'https://user:pass@docs.google.com/document/d/x',
        'https://example.com/?next=https://docs.google.com/document/d/x',
        'https://docs.google.com/document/d/x\n', 'https://docs.google.com/document/d/x y',
      ]) await invalid(() => insert({ [field]: url }));
    }
    await invalid(() => insert({ recado_url: null }));
  });

  test('commit exige 40 hex e deploy aceita HTTPS generico sem credenciais', async () => {
    for (const commit_hash of [null, 'a'.repeat(40), 'ABCDEF0123'.repeat(4)]) await insert({ commit_hash });
    for (const commit_hash of ['', 'abc1234', 'g'.repeat(40), 'a'.repeat(41)]) await invalid(() => insert({ commit_hash }));
    for (const deploy_url of [null, 'https://github.com/owner/repo/actions/runs/123', 'https://owner.github.io/painel/nova.html', 'https://preview.example.test/release?x=1#ready']) await insert({ deploy_url });
    for (const deploy_url of ['', ' ', 'http://example.com', 'javascript:alert(1)', 'https://user:pass@example.com/', 'https://user@example.com/', 'https://example.com/path\n', 'https://example.com/a b']) await invalid(() => insert({ deploy_url }));
  });

  test('reaplicar migracao preserva registros, evidencia e permissao de leitura', async () => {
    await insert(complete({ item_id: 'PRESERVAR', commit_hash: 'a'.repeat(40), motivo_bloqueio: 'Historico da decisao' }));
    const original = await rows();
    await pg.exec(migration);
    await pg.exec(migration);
    assert.deepEqual(await rows(), original);
    assert.deepEqual(await asRole('authenticated', USER, rows), original);
    assert.equal((await pg.query("SELECT count(*) AS n FROM pg_policies WHERE tablename='engenharia_itens' AND schemaname='public'")).rows[0].n, 1);
  });

  test('rollback repetido corta leitura do app sem perder tabela, dados ou recuperacao', async () => {
    await insert(complete({ item_id: 'PRESERVAR' }));
    const original = await rows();
    await pg.exec(rollback);
    await pg.exec(rollback);
    assert.deepEqual(await rows(), original);
    await asRole('authenticated', USER, () => denied(rows));
    await asRole('anon', USER, () => denied(rows));
    assert.deepEqual(await asRole('service_role', null, rows), original);
    assert.equal((await pg.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.engenharia_itens'::regclass")).rows[0].relrowsecurity, true);
    await pg.exec(migration);
    assert.deepEqual(await asRole('authenticated', USER, rows), original);
    assert.deepEqual((await pg.query('SELECT * FROM public.servicos ORDER BY id')).rows, [{ id: 1, status: 'pronto' }, { id: 2, status: 'producao' }]);
  });

  test('rollback tambem e seguro antes de a tabela existir', async () => {
    const empty = await PGlite.create();
    try {
      await empty.exec(rollback);
      await empty.exec(rollback);
      assert.equal((await empty.query("SELECT to_regclass('public.engenharia_itens') AS tabela")).rows[0].tabela, null);
    } finally { await empty.close(); }
  });
});

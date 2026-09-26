// Recado de 26/09/2026: a caixa de entrada vira fila com botões. Estes testes rodam as funções do nova.html
// que gravam (baixa, virar lead, virar compromisso, remarcar) contra um Postgres local (PGlite) com a trava
// do print e a RPC agenda_criar_da_caixa da produção. Nada aqui toca o banco real.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { before, after, beforeEach, test, describe } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');
const html = await read('nova.html');
const source = html.match(/<script type="text\/plain" id="app-source">([\s\S]*?)<\/script>/)[1];

// Pega uma declaração de topo do app: função (fecha com "}" na coluna 0) ou const de uma linha / objeto.
function pegar(nome) {
  const m = new RegExp(`\\n((?:async )?function ${nome}\\(|const ${nome} =)`).exec(source);
  assert.ok(m, 'não achei ' + nome + ' no nova.html');
  const ini = m.index + 1;
  const linha = source.slice(ini, source.indexOf('\n', ini));
  const saldo = (linha.match(/[{[(]/g) || []).length - (linha.match(/[}\])]/g) || []).length;
  if (saldo === 0) return linha;
  const fim = source.indexOf(linha.startsWith('const') ? '\n};' : '\n}\n', ini);
  return source.slice(ini, fim + 3);
}
const blocoCaixa = source.slice(source.indexOf('// ===== A CAIXA VOLTA COMO FILA'), source.indexOf('function CaixaView('));
assert.ok(blocoCaixa.length > 1000, 'bloco da caixa não encontrado');
const dependencias = [
  'TIPO_EVENTO_OPERACAO', 'CIDADES_TB', 'CIDADE_SINONIMOS', 'DIAS_SEMANA', 'CLIENTE_SEM_NOME',
  'comoLista', 'parseInbox', 'extractLead', 'detectCidade', 'cidadeChave', 'detectValor', 'detectPrazo', 'isoData',
  'semAcentoBaixo', 'corrigirTelefone', 'ehTelefoneFixo', 'ultimaMetaRemarcacao', 'metaEventoOperacao', 'lerRegistro',
  'nomeDoCliente', 'jsonCanonico', 'uuidDeterministicoEvento', 'sha256', 'mesmoValorBanco', 'inserirComIdDeterministico',
  'trocarMetaEvento', 'iniciarEventoOperacao', 'marcarEtapaEvento', 'concluirEventoOperacao', 'falharEventoOperacao',
  'resolverPendenciaComSucessor', 'processarEventoOperacaoBahia',
].map(pegar).join('\n');
const ajudante = vm.createContext({});
vm.runInContext(await read('agenda-caixa.js'), ajudante);
const app = vm.createContext({ crypto: globalThis.crypto, TextEncoder, BahiaAgendaCaixa: ajudante.BahiaAgendaCaixa, window: { BahiaAgendaCaixa: ajudante.BahiaAgendaCaixa } });
vm.runInContext(dependencias + '\n' + blocoCaixa, app);

// Cliente no formato do supabase-js, só com o que o app usa, por cima do PGlite.
function clienteSupabase(pg) {
  const col = (c) => '"' + c + '"';
  const valor = (v) => (v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v);
  class Consulta {
    constructor(tabela) { Object.assign(this, { tabela, acao: 'select', colunas: '*', retorno: null, filtros: [], valores: [], limite: null }); }
    select(c = '*') { if (this.acao === 'select') this.colunas = c; else this.retorno = c; return this; }
    insert(dados) { this.acao = 'insert'; this.dados = dados; return this; }
    update(dados) { this.acao = 'update'; this.dados = dados; return this; }
    eq(c, v) { this.valores.push(v); this.filtros.push(`${col(c)} = $${this.valores.length}`); return this; }
    ilike(c, v) { this.valores.push(v); this.filtros.push(`${col(c)} ILIKE $${this.valores.length}`); return this; }
    not(c, op, v) { assert.ok(op === 'is' && v === null, 'not() só com is null'); this.filtros.push(`${col(c)} IS NOT NULL`); return this; }
    limit(n) { this.limite = n; return this; }
    async rodar() {
      const where = this.filtros.length ? ' WHERE ' + this.filtros.join(' AND ') : '';
      let sql, params = [...this.valores];
      if (this.acao === 'select') sql = `SELECT ${this.colunas} FROM public.${this.tabela}${where}${this.limite ? ' LIMIT ' + this.limite : ''}`;
      else {
        const chaves = Object.keys(this.dados);
        if (this.acao === 'insert') {
          sql = `INSERT INTO public.${this.tabela}(${chaves.map(col).join(',')}) VALUES (${chaves.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING ${this.retorno || '*'}`;
          params = chaves.map((k) => valor(this.dados[k]));
        } else {
          sql = `UPDATE public.${this.tabela} SET ${chaves.map((k, i) => `${col(k)} = $${params.length + i + 1}`).join(', ')}${where} RETURNING ${this.retorno || 'id'}`;
          params = [...params, ...chaves.map((k) => valor(this.dados[k]))];
        }
      }
      try { return { data: (await pg.query(sql, params)).rows, error: null }; } catch (e) { return { data: null, error: { message: e.message, code: e.code } }; }
    }
    then(ok, falha) { return this.rodar().then(ok, falha); }
    async single() { const r = await this.rodar(); if (r.error) return r; return r.data.length === 1 ? { data: r.data[0], error: null } : { data: null, error: { message: 'esperava 1 linha', code: 'PGRST116' } }; }
    async maybeSingle() { const r = await this.rodar(); return r.error ? r : { data: r.data[0] || null, error: null }; }
  }
  return {
    from: (tabela) => new Consulta(tabela),
    async rpc(nome, args) {
      const chaves = Object.keys(args);
      try { return { data: (await pg.query(`SELECT public.${nome}(${chaves.map((k, i) => `${k} => $${i + 1}`).join(', ')}) AS r`, chaves.map((k) => args[k]))).rows[0].r, error: null }; }
      catch (e) { return { data: null, error: { message: e.message, code: e.code } }; }
    },
  };
}

const USUARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRINT = '[[TB_INBOX_IMG]]https://exemplo.invalid/print.jpg\n[[TB_INBOX_FILE]]print.jpg\n[[TB_INBOX_NOTE]]Print de conversa fictícia';
const item = (id, outros = {}) => ({ id, texto: 'Entrada fictícia', status: 'novo', processado: false, conversa: [], criado_em: '2026-09-01T12:00:00Z', ...outros });

test('tipo de cada item decide rótulo e botões, e a fila só mostra o que é de gente', () => {
  const agora = Date.parse('2026-09-26T22:00:00Z');
  const checkpoint = (estado, criado_em) => item('op-' + estado + criado_em, { criado_em, texto: 'Aplicando operação: financeiro · x', conversa: [{ meta: { tipo_operacional: 'evento_operacao_bahia', estado } }] });
  const casos = [
    [item('r1', { texto: 'Precisa remarcar: fictício', conversa: [{ meta: { tipo_operacional: 'remarcacao', agenda_origem_id: 'x' } }] }), 'remarcacao'],
    [item('r2', { conversa: [{ meta: { tipo_operacional: 'remarcacao', agenda_sucessora_id: 'y' } }] }), 'anotacao'],
    [item('p1', { status: 'aguardando_voce', texto: 'Qual foi o valor?' }), 'pergunta'],
    [item('p2', { conversa: [{ meta: { tipo_operacional: 'pergunta_operacao' } }] }), 'pergunta'],
    [item('l1', { texto: 'BLOQUEIO DE CADASTRO — Fulana — WhatsApp +55 61 9671-8270' }), 'lead'],
    [item('l2', { texto: '🔴 LEAD BLOQUEADO — Fulana — +55 61 99154-1582' }), 'lead'],
    [item('l3', { texto: 'Lead WhatsApp +55 61 98165-1527 — quer orçamento' }), 'lead'],
    [item('l4', { texto: '🔴 URGENTE HOJE — lead novo', conversa: [{ meta: { tipo_operacional: 'lead_nao_localizado' } }] }), 'lead'],
    [item('i1', { texto: PRINT }), 'print'],
    [item('a1', { texto: 'CONTABILIDADE — consolidar pendências' }), 'anotacao'],
    [checkpoint('concluido', '2026-09-13T12:00:00Z'), 'operacao_concluida'],
    [checkpoint('aplicando', '2026-09-26T21:59:00Z'), 'operacao_em_curso'],
    [checkpoint('aplicando', '2026-09-26T21:00:00Z'), 'operacao_travada'],
    [checkpoint('falhou', '2026-09-26T21:59:30Z'), 'operacao_travada'],
  ];
  for (const [entrada, esperado] of casos) assert.equal(app.tipoDoItemDaCaixa(entrada, agora), esperado, entrada.id);
  const fila = app.itensDaFilaDaCaixa([...casos.map(([e]) => e), item('ja', { processado: true })], agora);
  const ids = Array.from(fila, (e) => e.id);
  assert.ok(!ids.includes('ja'), 'processado não entra');
  assert.ok(!ids.some((id) => /concluido|op-aplicando2026-09-26T21:59/.test(id)), 'registro automático do app não entra');
  assert.ok(ids.includes('op-aplicando2026-09-26T21:00:00Z') && ids.includes('op-falhou2026-09-26T21:59:30Z'), 'operação travada entra');
  assert.deepEqual(ids, [...ids].sort((a, b) => String(fila.find((e) => e.id === a).criado_em).localeCompare(String(fila.find((e) => e.id === b).criado_em))), 'mais antigo primeiro');
});

test('pré-preenchimento lê o jeito que os agentes escrevem na caixa', () => {
  assert.equal(app.telefoneDoTextoDaCaixa('BLOQUEIO DE CADASTRO — Amanda — WhatsApp +55 61 9671-8270 — Luziânia'), '+55 61 9671-8270');
  assert.equal(app.corrigirTelefone('+55 61 9671-8270'), '+55 61 99671-8270');
  assert.equal(app.telefoneDoTextoDaCaixa('Oi, meu WhatsApp é (61) 90000-0000.'), '(61) 90000-0000');
  assert.equal(app.telefoneDoTextoDaCaixa('Pendência de contabilidade de agosto'), '');
  assert.equal(app.nomeDoTextoDaCaixa('🔴 LEAD BLOQUEADO — Giovanna — +55 61 99154-1582. Pedir cidade'), 'Giovanna');
  assert.equal(app.nomeDoTextoDaCaixa('Lead WhatsApp +55 61 98165-1527 — mudança para Luziânia — quer orçamento'), '');
  assert.equal(app.nomeDoTextoDaCaixa('Oi, sou Mariana, moro no Jardim Ingá'), 'Mariana');
  assert.equal(app.servicoDoTextoDaCaixa('pediu orçamento para 2 sofás'), 'Reforma de sofá');
  assert.equal(app.servicoDoTextoDaCaixa('orçamento para 2 sofás e 2 poltronas; troca do tecido'), 'Reforma de sofá', 'vale a peça que aparece primeiro');
  assert.equal(app.servicoDoTextoDaCaixa('quer reformar/revestir canto alemão'), 'Reforma de canto alemão');
  assert.equal(app.servicoDoTextoDaCaixa('higienização do sofá de 3 lugares'), 'Higienização de sofá');
  assert.equal(app.tituloDoTextoDaCaixa('🔴 URGENTE HOJE — lead novo\nsegunda linha'), 'URGENTE HOJE — lead novo');
});

describe('gravação — PostgreSQL local com as travas da produção', () => {
  let pg, db;
  before(async () => {
    pg = await PGlite.create();
    await pg.exec(`
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
      CREATE SCHEMA auth; CREATE SCHEMA private;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA auth TO authenticated;
      CREATE FUNCTION public.usuario_autorizado() RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(auth.uid()='${USUARIO}'::uuid,false) $$;
      CREATE TABLE public.clientes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nome text, telefone text, cidade text, endereco text, obs text, criado_em timestamptz DEFAULT now());
      CREATE TABLE public.servicos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cliente_id uuid REFERENCES clientes, titulo text NOT NULL, status text NOT NULL, prioridade text, proxima_acao text, prazo date, criado_em timestamptz DEFAULT now());
      CREATE TABLE public.caixa_entrada(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), texto text NOT NULL, criado_em timestamptz DEFAULT now(), processado boolean DEFAULT false, processado_em timestamptz, status text DEFAULT 'novo', conversa jsonb DEFAULT '[]');
      CREATE TABLE public.agenda(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cliente_id uuid REFERENCES clientes, servico_id uuid REFERENCES servicos, titulo text, data date, hora time, tipo text, cidade text, status text);
      CREATE TABLE public.historico(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), o_que text, por text, detalhe text, criado_em timestamptz DEFAULT now());
      CREATE FUNCTION private.whatsapp_phone_ok(t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT t IS NOT NULL AND regexp_replace(t,'\\D','','g') ~ '^55[1-9][0-9]9[6-9][0-9]{7}$' $$;
      CREATE FUNCTION private.trg_agenda_servico_exige_whatsapp() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN new; END $$;
      CREATE TRIGGER agenda_servico_exige_whatsapp BEFORE INSERT OR UPDATE OF servico_id,status ON public.agenda FOR EACH ROW EXECUTE FUNCTION private.trg_agenda_servico_exige_whatsapp();
      -- Cópia fiel da trava da produção (public.trava_caixa_print_precisa_ser_lido, lida em 26/09/2026).
      CREATE FUNCTION public.trava_caixa_print_precisa_ser_lido() RETURNS trigger LANGUAGE plpgsql AS $$
      begin
        if new.processado = true and coalesce(old.processado, false) = false and new.texto like '%[[TB_INBOX_IMG]]%'
           and not exists (select 1 from jsonb_array_elements(coalesce(new.conversa::jsonb, '[]'::jsonb)) as m where (m -> 'meta' ->> 'print_lido') = 'true') then
          raise exception 'Este item tem print e nada registra que ele foi aberto.';
        end if;
        return new;
      end $$;
      CREATE TRIGGER trg_caixa_print_precisa_ser_lido BEFORE INSERT OR UPDATE ON public.caixa_entrada FOR EACH ROW EXECUTE FUNCTION public.trava_caixa_print_precisa_ser_lido();
      -- Cópias fiéis das travas de serviço/cliente/agenda da produção (lidas em 26/09/2026).
      CREATE FUNCTION private.trg_agenda_planejado_exige_hora() RETURNS trigger LANGUAGE plpgsql AS $$
      begin
        if new.status = 'planejado' and new.hora is null then
          raise exception using errcode = '23514', message = 'AGENDA_PLANEJADA_EXIGE_HORA';
        end if;
        return new;
      end $$;
      CREATE TRIGGER trg_agenda_planejado_exige_hora BEFORE INSERT OR UPDATE ON public.agenda FOR EACH ROW EXECUTE FUNCTION private.trg_agenda_planejado_exige_hora();
      CREATE FUNCTION private.trg_servico_exige_whatsapp() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
      declare v_tel text;
      begin
        if new.status in ('lead','orcamento','agendado','producao','pronto') then
          if new.cliente_id is null then raise exception 'Serviço ativo exige cliente vinculado'; end if;
          select c.telefone into v_tel from public.clientes c where c.id = new.cliente_id;
          if not private.whatsapp_phone_ok(v_tel) then raise exception 'Serviço ativo exige cliente com WhatsApp válido'; end if;
        end if;
        return new;
      end $$;
      CREATE TRIGGER servico_exige_whatsapp BEFORE INSERT OR UPDATE ON public.servicos FOR EACH ROW EXECUTE FUNCTION private.trg_servico_exige_whatsapp();
      ${['clientes', 'servicos', 'caixa_entrada', 'agenda', 'historico'].map((t) => `ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY; GRANT SELECT,INSERT,UPDATE,DELETE ON public.${t} TO authenticated; CREATE POLICY operador ON public.${t} TO authenticated USING (public.usuario_autorizado()) WITH CHECK (public.usuario_autorizado());`).join('\n')}
    `);
    await pg.exec(await read('migracoes/20260915153735_agenda_caixa_identidade.sql'));
    db = clienteSupabase(pg);
  });
  after(async () => { await pg?.close(); });
  beforeEach(async () => {
    await pg.exec('RESET ROLE; TRUNCATE historico, agenda, caixa_entrada, servicos, clientes;');
    await pg.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [USUARIO]);
    await pg.exec('SET ROLE authenticated');
  });
  const novaEntrada = async (texto, extra = {}) => (await pg.query('INSERT INTO caixa_entrada(texto, status, conversa) VALUES ($1, $2, $3) RETURNING *', [texto, extra.status || 'novo', JSON.stringify(extra.conversa || [])])).rows[0];
  const linha = async (tabela, id) => (await pg.query(`SELECT * FROM ${tabela} WHERE id = $1`, [id])).rows[0];
  const contar = async (tabela) => (await pg.query(`SELECT count(*)::int AS n FROM ${tabela}`)).rows[0].n;

  test('baixa de print passa pela trava do banco; escrita direta sem carimbo continua barrada', async () => {
    const e = await novaEntrada(PRINT, { status: 'CONFIRMAR' });
    await assert.rejects(pg.query('UPDATE caixa_entrada SET processado = true WHERE id = $1', [e.id]), /tem print/);
    await app.processarItemDaCaixa(db, e, { acao: 'descartado', nota: 'duplicado' });
    const gravado = await linha('caixa_entrada', e.id);
    assert.equal(gravado.processado, true);
    assert.equal(gravado.status, 'resolvido');
    const meta = gravado.conversa.at(-1).meta;
    assert.equal(meta.tipo_operacional, 'caixa_processada');
    assert.equal(meta.acao, 'descartado');
    assert.equal(meta.status_anterior, 'CONFIRMAR', 'o status antigo não se perde');
    assert.equal(meta.print_lido, true);
    await assert.rejects(app.processarItemDaCaixa(db, e, { acao: 'resolvido' }), /já foi processado/);
  });

  test('resposta a pergunta entra como mensagem do Diego e preserva a conversa', async () => {
    const pergunta = { de: 'ia', texto: 'Qual foi o valor do material?', em: '2026-08-16T12:00:00Z' };
    const e = await novaEntrada('Qual foi o valor do material?', { status: 'aguardando_voce', conversa: [pergunta] });
    await app.processarItemDaCaixa(db, e, { acao: 'respondido', nota: 'R$ 180', resposta: true });
    const conversa = (await linha('caixa_entrada', e.id)).conversa;
    assert.deepEqual(conversa[0], pergunta);
    assert.deepEqual({ de: conversa[1].de, texto: conversa[1].texto }, { de: 'diego', texto: 'R$ 180' });
    assert.equal(conversa[2].meta.acao, 'respondido');
  });

  test('lead com BLOQUEIO e telefone de 10 dígitos: exige confirmação, grava tudo ligado e não duplica', async () => {
    const e = await novaEntrada('BLOQUEIO DE CADASTRO — Fulana — WhatsApp +55 61 9671-8270 — Luziânia. Pediu orçamento de sofá.');
    const dados = { nome: 'Fulana', telefone: '+55 61 99671-8270', cidade: 'Luziânia', servico: 'Reforma de sofá', proximaAcao: 'Mandar o orçamento', data: '2026-09-28', hora: '09:00' };
    await assert.rejects(app.virarLeadDaCaixa(db, e, { ...dados, telefone: '+55 61 9671-8270', confirmado: true }), /WhatsApp inválido/);
    await assert.rejects(app.virarLeadDaCaixa(db, e, { ...dados, confirmado: false }), /BLOQUEIO DE CADASTRO/);
    assert.equal(await contar('clientes'), 0, 'nada gravado antes da confirmação');
    const r = await app.virarLeadDaCaixa(db, e, { ...dados, confirmado: true });
    assert.equal(r.cliente.telefone, '+55 61 99671-8270');
    assert.equal(r.servico.status, 'lead');
    assert.equal(r.compromisso.caixa_entrada_id, e.id);
    assert.equal(r.compromisso.cliente_id, r.cliente.id);
    assert.equal(r.compromisso.servico_id, r.servico.id);
    const caixa = await linha('caixa_entrada', e.id);
    assert.equal(caixa.processado, true);
    const metas = caixa.conversa.map((m) => m.meta?.tipo_operacional);
    assert.deepEqual(metas, ['cadastro_validado', 'caixa_processada']);
    assert.equal(caixa.conversa.at(-1).meta.agenda_id, r.compromisso.id);
    assert.equal(await contar('historico'), 1);
    await assert.rejects(app.virarLeadDaCaixa(db, e, { ...dados, confirmado: true }), /já foi processado/);
    assert.deepEqual([await contar('clientes'), await contar('servicos'), await contar('agenda')], [1, 1, 1], 'repetir não duplica');
  });

  test('lead cujo WhatsApp já tem ficha vai pra ficha existente, mesmo escrito de outro jeito', async () => {
    const existente = (await pg.query("INSERT INTO clientes(nome, telefone) VALUES ('Beltrano', '5561991541582') RETURNING id")).rows[0].id;
    const e = await novaEntrada('Lead WhatsApp +55 61 99154-1582 — quer orçamento de poltrona');
    const r = await app.virarLeadDaCaixa(db, e, { nome: 'Outro nome', telefone: '+55 61 99154-1582', servico: 'Reforma de poltrona', proximaAcao: 'Responder', data: '2026-09-28', hora: '10:00' });
    assert.equal(r.cliente.id, existente);
    assert.equal(await contar('clientes'), 1);
    assert.equal((await linha('caixa_entrada', e.id)).conversa.some((m) => m.meta?.tipo_operacional === 'cadastro_validado'), false, 'sem bloqueio não carimba validação');
  });

  test('virar compromisso avulso liga o cartão à entrada e dá baixa', async () => {
    const e = await novaEntrada('Comprar porca de garra na loja');
    const r = await app.virarCompromissoDaCaixa(db, e, { natureza: 'avulso', titulo: 'Comprar porca de garra', data: '2026-09-29', hora: '15:00', tipo: 'operacional', cidade: 'Luziânia' });
    assert.equal(r.compromisso.caixa_entrada_id, e.id);
    assert.equal(r.compromisso.cliente_id, null);
    assert.equal((await linha('caixa_entrada', e.id)).conversa.at(-1).meta.acao, 'virou_compromisso');
  });

  test('remarcar pela porta única move o compromisso original e o checkpoint não vira item da fila', async () => {
    const origem = (await pg.query("INSERT INTO agenda(titulo, data, hora, tipo, status) VALUES ('Visita fictícia', '2026-08-17', '14:00', 'remoto', 'planejado') RETURNING id")).rows[0].id;
    const meta = { tipo_operacional: 'remarcacao', versao: 1, agenda_origem_id: origem, servico_id: null, titulo_original: 'Visita fictícia', data_original: '2026-08-17', tipo_original: 'remoto', motivo: 'não atendeu', agenda_sucessora_id: null };
    const e = await novaEntrada('Precisa remarcar: Visita fictícia', { conversa: [{ de: 'ia', tipo: 'sistema', texto: 'Pendência criada.', meta }] });
    await app.remarcarDaCaixa(db, e, { data: '2026-09-30', hora: '11:00', tipo: 'remoto', titulo: 'Visita fictícia' });
    const agenda = await linha('agenda', origem);
    assert.equal(agenda.data.toISOString().slice(0, 10), '2026-09-30');
    assert.equal(agenda.status, 'planejado');
    const pendencia = await linha('caixa_entrada', e.id);
    assert.equal(pendencia.processado, true);
    const checkpoints = (await pg.query("SELECT * FROM caixa_entrada WHERE id <> $1", [e.id])).rows;
    assert.equal(checkpoints.length, 1, 'a porta única deixa um checkpoint');
    assert.equal(checkpoints[0].processado, true);
    assert.equal(app.itensDaFilaDaCaixa(checkpoints.map((c) => ({ ...c, criado_em: c.criado_em.toISOString() }))).length, 0, 'checkpoint concluído não entra na fila');
  });
});

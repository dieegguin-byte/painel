-- Monitor informativo solicitado no ITEM AGENTE-NUVEM-REDIRECIONAMENTO-20260914-2204-001.
-- Instala somente o schema. O agendamento fica em conferencia-ativacao.sql.
-- Fonte da regra: servicos.status = 'pronto'. Nenhum estado de negocio e alterado.
begin;

create schema if not exists private;

create table public.conferencia_ocorrencias (
  regra text not null check (regra = 'SERVICO_PRONTO'),
  servico_id uuid not null,
  ativa boolean not null default true,
  detectada_em timestamptz not null,
  confirmada_em timestamptz not null,
  encerrada_em timestamptz,
  regra_versao integer not null check (regra_versao > 0),
  primary key (regra, servico_id),
  constraint conferencia_ocorrencia_datas check (confirmada_em >= detectada_em),
  constraint conferencia_ocorrencia_estado check (
    (ativa and encerrada_em is null) or (not ativa and encerrada_em is not null)
  )
);

comment on table public.conferencia_ocorrencias is
  'Projecao tecnica idempotente de servicos com status pronto. Nao e tarefa, fila de operacao, diario nem confirmacao de entrega fisica. Sem copia de nomes e sem FK que bloqueie o servico.';

create table public.conferencia_estado (
  id smallint primary key check (id = 1),
  ultima_conclusao_em timestamptz,
  ocorrencias_ativas integer not null default 0 check (ocorrencias_ativas >= 0),
  execucoes bigint not null default 0 check (execucoes >= 0)
);

comment on table public.conferencia_estado is
  'Uma linha com a ultima varredura concluida. Nao guarda historico de execucoes; o pg_cron ja fornece esse historico tecnico.';

insert into public.conferencia_estado (id) values (1);

alter table public.conferencia_ocorrencias owner to postgres;
alter table public.conferencia_estado owner to postgres;
alter table public.conferencia_ocorrencias enable row level security;
alter table public.conferencia_estado enable row level security;

revoke all on table public.conferencia_ocorrencias from public, anon, authenticated, service_role;
revoke all on table public.conferencia_estado from public, anon, authenticated, service_role;
grant select on table public.conferencia_ocorrencias to authenticated;
grant select on table public.conferencia_estado to authenticated;

create policy conferencia_ocorrencias_leitura_autorizada
  on public.conferencia_ocorrencias for select to authenticated
  using (
    (select public.usuario_autorizado())
    and exists (
      select 1 from public.servicos as s
       where s.id = conferencia_ocorrencias.servico_id
    )
  );

create policy conferencia_estado_leitura_autorizada
  on public.conferencia_estado for select to authenticated
  using ((select public.usuario_autorizado()));

create function private.conferencia_executar()
returns void
language plpgsql
security invoker
set search_path = ''
set statement_timeout = '10s'
set lock_timeout = '1s'
as $function$
declare
  v_ids uuid[];
  v_observado_em timestamptz;
begin
  -- Outra chamada concorrente sai sem tocar na projecao ou no heartbeat.
  if not pg_catalog.pg_try_advisory_xact_lock(15430914, 1) then
    return;
  end if;

  -- Um unico snapshot do predicado oficial; sem dados pessoais nem travas nos servicos.
  select coalesce(pg_catalog.array_agg(s.id order by s.id), array[]::uuid[])
    into v_ids
    from public.servicos as s
   where s.status = 'pronto';
  v_observado_em := pg_catalog.clock_timestamp();

  insert into public.conferencia_ocorrencias as atual
    (regra, servico_id, ativa, detectada_em, confirmada_em, encerrada_em, regra_versao)
  select 'SERVICO_PRONTO', alvo.id, true, v_observado_em, v_observado_em, null, 1
    from pg_catalog.unnest(v_ids) as alvo(id)
  on conflict (regra, servico_id) do update
    set ativa = true,
        detectada_em = case
          when atual.ativa and atual.regra_versao = excluded.regra_versao
            then atual.detectada_em
          else excluded.detectada_em
        end,
        confirmada_em = excluded.confirmada_em,
        encerrada_em = null,
        regra_versao = excluded.regra_versao;

  -- Sair do predicado encerra APENAS a ocorrencia tecnica; nunca muda o servico.
  update public.conferencia_ocorrencias as ocorrencia
     set ativa = false,
         encerrada_em = v_observado_em
   where ocorrencia.regra = 'SERVICO_PRONTO'
     and ocorrencia.ativa
     and not (ocorrencia.servico_id = any(v_ids));

  -- Ultima conclusao so avanca se todos os passos forem confirmados na transacao.
  -- Nao capturar/engolir excecoes: falha reverte projecao e heartbeat juntos.
  update public.conferencia_estado
     set ultima_conclusao_em = pg_catalog.clock_timestamp(),
         ocorrencias_ativas = pg_catalog.cardinality(v_ids),
         execucoes = execucoes + 1
   where id = 1;
  if not found then
    raise exception using errcode = '55000', message = 'Estado tecnico do monitor indisponivel.';
  end if;
end;
$function$;

alter function private.conferencia_executar() owner to postgres;
revoke all on function private.conferencia_executar() from public, anon, authenticated, service_role;
grant execute on function private.conferencia_executar() to postgres;

comment on function private.conferencia_executar() is
  'Worker SQL interno: somente postgres. Le servicos.id/status; escreve somente conferencia_ocorrencias e conferencia_estado. Regra SERVICO_PRONTO v1.';

create function public.conferencia_monitor()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_ultima_conclusao_em timestamptz;
  v_ocorrencias jsonb;
  v_total bigint;
begin
  if not coalesce(public.usuario_autorizado(), false) then
    raise exception using errcode = '42501', message = 'Acesso nao autorizado ao monitor.';
  end if;

  select estado.ultima_conclusao_em
    into v_ultima_conclusao_em
    from public.conferencia_estado as estado
   where estado.id = 1;

  -- A funcao STABLE usa o snapshot da consulta. RLS permanece aplicado nas fontes.
  -- O status atual filtra uma ocorrencia que ficou antiga antes do proximo cron.
  with atuais as materialized (
    select s.id as servico_id, s.cliente_id, s.titulo, s.status,
           ocorrencia.detectada_em, ocorrencia.confirmada_em
      from public.conferencia_ocorrencias as ocorrencia
      join public.servicos as s on s.id = ocorrencia.servico_id
     where ocorrencia.regra = 'SERVICO_PRONTO'
       and ocorrencia.regra_versao = 1
       and ocorrencia.ativa
       and s.status = 'pronto'
  ), exibidas as (
    select * from atuais
     order by detectada_em asc, servico_id asc
     limit 500
  )
  select (select pg_catalog.count(*) from atuais),
         coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(exibida)
                    order by exibida.detectada_em asc, exibida.servico_id asc)
                     from exibidas as exibida), '[]'::jsonb)
    into v_total, v_ocorrencias;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'consultado_em', pg_catalog.statement_timestamp(),
    'ultima_conclusao_em', v_ultima_conclusao_em,
    'intervalo_segundos', 300,
    'regra', pg_catalog.jsonb_build_object(
      'id', 'SERVICO_PRONTO',
      'versao', 1,
      'titulo', 'Pronto — entrega ainda não registrada no status',
      'descricao', 'O serviço está registrado como pronto. Esta situação é informativa: o status, por si só, não comprova se a entrega física aconteceu. Nenhum estado do serviço é alterado pelo monitor.',
      'fonte', 'public.servicos.status = pronto'
    ),
    'ocorrencias', v_ocorrencias,
    'total', v_total,
    'completo', v_ultima_conclusao_em is not null and v_total <= 500
  );
end;
$function$;

alter function public.conferencia_monitor() owner to postgres;
revoke all on function public.conferencia_monitor() from public, anon, authenticated, service_role;
grant execute on function public.conferencia_monitor() to authenticated;

comment on function public.conferencia_monitor() is
  'Leitura autenticada e autorizada, SECURITY INVOKER. Retorna no maximo 500 ocorrencias com total real; nunca executa varredura ou altera dados.';


-- Consulta sob demanda. Usa a sessão do próprio app e respeita RLS.
-- Nenhuma chamada de modelo, escrita de negócio ou execução do monitor.
create or replace function public.conferencia_consultar_servico(p_servico_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set statement_timeout = '10s'
as $function$
declare
  v_servico record;
  v_agenda jsonb;
  v_materiais jsonb;
  v_observacoes jsonb := '[]'::jsonb;
  v_total bigint;
begin
  if auth.uid() is null or not coalesce(public.usuario_autorizado(), false) then
    raise exception 'Conta não autorizada a consultar a operação.' using errcode = '42501';
  end if;

  select s.id, s.titulo, s.status, s.proxima_acao, s.prazo,
         s.profissional, s.responsavel, s.loja_material,
         s.data_entrega_material, s.materiais_necessarios
    into v_servico
    from public.servicos s where s.id = p_servico_id;
  if not found then
    return jsonb_build_object('ok', false, 'erro', jsonb_build_object(
      'codigo', 'SERVICO_NAO_ENCONTRADO',
      'mensagem', 'O serviço não foi encontrado ou não está disponível para esta conta.'));
  end if;

  select count(*) into v_total from public.agenda a
    where a.servico_id = p_servico_id and a.status = 'planejado';
  if v_total > 100 then
    return jsonb_build_object('ok', false, 'erro', jsonb_build_object(
      'codigo', 'LIMITE_COMPROMISSOS',
      'mensagem', 'Este serviço tem mais de 100 compromissos planejados. A consulta não será apresentada parcialmente.'));
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'titulo', a.titulo, 'data', a.data, 'hora', a.hora, 'status', a.status
  ) order by a.data, a.hora nulls last, a.id), '[]'::jsonb)
    into v_agenda from public.agenda a
    where a.servico_id = p_servico_id and a.status = 'planejado';

  if jsonb_typeof(v_servico.materiais_necessarios) = 'array' then
    select coalesce(jsonb_agg(
      case when jsonb_typeof(m.valor) = 'object' then coalesce((
        select jsonb_object_agg(k.key, k.value)
        from jsonb_each(m.valor) k
        where k.key in ('item', 'material', 'descricao', 'estado', 'status', 'comprado',
                        'pedido', 'arquivado', 'quantidade', 'unidade',
                        'quantidade_status', 'disponibilidade_status')
          and jsonb_typeof(k.value) in ('string','number','boolean','null')
      ), '{"registro_nao_interpretado":true}'::jsonb)
      else '{"registro_nao_interpretado":true}'::jsonb end order by m.ordem
    ), '[]'::jsonb) into v_materiais
    from jsonb_array_elements(v_servico.materiais_necessarios) with ordinality m(valor, ordem);
  else
    v_materiais := 'null'::jsonb;
    v_observacoes := jsonb_build_array('O campo de materiais tem um formato que esta consulta não interpreta.');
  end if;

  return jsonb_build_object(
    'ok', true, 'modo', 'regras', 'consultado_em', statement_timestamp(),
    'servico', jsonb_build_object(
      'id', v_servico.id, 'titulo', v_servico.titulo, 'status', v_servico.status,
      'proxima_acao', v_servico.proxima_acao, 'prazo', v_servico.prazo,
      'profissional', v_servico.profissional, 'responsavel', v_servico.responsavel,
      'loja_material', v_servico.loja_material, 'data_entrega_material', v_servico.data_entrega_material,
      'materiais_necessarios', v_materiais),
    'compromissos', v_agenda,
    'resumo', format('Status registrado: %s. Próxima ação registrada: %s. Compromissos vinculados com status planejado: %s.',
      v_servico.status, coalesce(nullif(btrim(v_servico.proxima_acao), ''), 'não informada'), v_total),
    'observacoes', v_observacoes,
    'limites', jsonb_build_array(
      'Fatos lidos de um serviço e dos registros de agenda diretamente vinculados a ele.',
      'A lista não interpreta remarcações; pode diferir da agenda operacional exibida pelo app.',
      'Datas e status planejado não confirmam que um compromisso aconteceu.',
      'Campos vazios não comprovam erro, atraso ou obrigação. Materiais são exibidos como registrados.',
      'Análise e decisão continuam com o Classic pelo botão ChatGPT já existente na ficha.'));
end;
$function$;

revoke all on function public.conferencia_consultar_servico(uuid) from public, anon, authenticated, service_role;
grant execute on function public.conferencia_consultar_servico(uuid) to authenticated;
comment on function public.conferencia_consultar_servico(uuid) is
  'Leitura sob demanda com sessão/RLS; sem LLM e sem executar worker ou alterar fatos de negócio.';

commit;

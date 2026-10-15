-- COMPROMISSO NA HORA, COM BOTÕES (Diego, 15/10/2026, olhando o Niagara: "se chegar na tela e eu puder
-- resolver sem entrar no app... ver meus próprios compromissos, marcar como feito, aí não precisaria da agenda").
--
-- O que muda:
--   1. push_pendencias devolve `agenda_na_hora` (card planejado com hora cuja hora chegou nos últimos 30 min)
--      e `agenda_hoje` (a lista do dia, pro resumo das 07:30 listar os compromissos pelo nome).
--   2. push_acao aprende a tabela "agenda": resposta "feito" segue O MESMO CAMINHO do botão Feito do app
--      (recado em agenda_recados + agenda.status = feito + pessoais quando é bloqueio pessoal), e "adiar"
--      empurra a hora em 1h e solta as chaves de aviso, pra que a nova hora avise de novo.
-- O lembrete de 60 min antes continua igual (chave agenda:<id>); o aviso na hora usa agenda-hora:<id> e a
-- MESMA tag de notificação, então substitui o lembrete na tela em vez de empilhar.
-- Idempotente. Aplicar com execute_sql em pedaços (statement_timeout), como em 13/10.

-- 1. push_pendencias
create or replace function public.push_pendencias() returns jsonb
language sql security definer set search_path = public as $$
with agora as (select (now() at time zone 'America/Sao_Paulo') as t),
     hoje  as (select (now() at time zone 'America/Sao_Paulo')::date as d),
     contas as (
       select f.id, f.descricao, f.categoria, f.escopo, f.valor, f.data, (f.data - hoje.d) as dias
       from financeiro f, hoje
       where f.status = 'a_pagar' and f.tipo = 'saida' and f.data is not null
         and coalesce(f.categoria, '') not in ('Vale', 'Mão de obra')
         and f.data <= hoje.d + 3
     )
select jsonb_build_object(
  'agora', (select t from agora),
  'hoje',  (select d from hoje),
  'agenda', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'titulo', coalesce(nullif(btrim(pe.titulo), ''), a.titulo), 'hora', to_char(a.hora,'HH24:MI'),
      'local', a.local, 'cidade', a.cidade, 'tipo', a.tipo, 'servico_id', a.servico_id,
      'faltam', floor(extract(epoch from ((a.data + a.hora) - agora.t))/60)::int,
      'na_janela', ((a.data + a.hora) <= agora.t + interval '60 minutes')
    ) order by (a.data + a.hora))
    from agenda a
    left join pessoais pe on pe.id = a.pessoal_id, agora
    where a.status = 'planejado' and a.hora is not null
      and (a.data + a.hora) >= agora.t
      and (a.data + a.hora) <= agora.t + interval '6 hours'
  ), '[]'::jsonb),
  -- NA HORA (15/10/2026): a hora do card chegou (até 30 min atrás, pra varredura de 5 min não perder nenhum).
  'agenda_na_hora', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'titulo', coalesce(nullif(btrim(pe.titulo), ''), a.titulo), 'hora', to_char(a.hora,'HH24:MI'),
      'local', a.local, 'cidade', a.cidade, 'tipo', a.tipo, 'servico_id', a.servico_id,
      'passaram', floor(extract(epoch from (agora.t - (a.data + a.hora)))/60)::int
    ) order by (a.data + a.hora))
    from agenda a
    left join pessoais pe on pe.id = a.pessoal_id, agora
    where a.status = 'planejado' and a.hora is not null
      and (a.data + a.hora) <= agora.t
      and (a.data + a.hora) > agora.t - interval '30 minutes'
  ), '[]'::jsonb),
  -- A LISTA DO DIA, pro resumo da manhã chamar cada compromisso pelo nome.
  'agenda_hoje', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'titulo', coalesce(nullif(btrim(pe.titulo), ''), a.titulo), 'hora', to_char(a.hora,'HH24:MI'),
      'cidade', a.cidade, 'tipo', a.tipo
    ) order by a.hora)
    from agenda a
    left join pessoais pe on pe.id = a.pessoal_id, hoje
    where a.status = 'planejado' and a.hora is not null and a.data = hoje.d
  ), '[]'::jsonb),
  'caixa', coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'texto', left(c.texto, 160)))
    from caixa_entrada c
    where c.processado = false and c.criado_em > now() - interval '24 hours'
  ), '[]'::jsonb),
  'duvidas', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'pergunta', left(d.pergunta, 200), 'contexto', left(d.contexto, 120), 'opcoes', d.opcoes,
      'origem', d.origem, 'cliente', c.nome, 'criado_em', d.criado_em
    ) order by d.criado_em)
    from duvidas_agente d left join clientes c on c.id = d.cliente_id
    where d.status = 'aberta' and d.criado_em > now() - interval '24 hours'
  ), '[]'::jsonb),
  'contas', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'descricao', c.descricao, 'categoria', c.categoria, 'escopo', c.escopo,
      'valor', c.valor, 'data', c.data, 'dias', c.dias
    ) order by c.data, c.valor desc)
    from contas c
  ), '[]'::jsonb),
  'resumo', (select jsonb_build_object(
    'compromissos_hoje',  (select count(*) from agenda a,     hoje where a.status='planejado' and a.data = hoje.d and a.hora is not null),
    'proximo_hoje',       (select to_char(min(a.hora),'HH24:MI') from agenda a, hoje where a.status='planejado' and a.data = hoje.d and a.hora is not null),
    'retornos_vencidos',  (select count(*) from servicos s,    hoje where s.status in ('lead','orcamento') and s.prazo is not null and s.prazo < hoje.d),
    'contas_vencendo',    (select count(*) from contas),
    'contas_valor',       (select coalesce(sum(valor),0)::numeric(12,2) from contas),
    'caixa_pendente',     (select count(*) from caixa_entrada where processado = false)
  ))
);
$$;
revoke execute on function public.push_pendencias() from public, anon, authenticated;
grant  execute on function public.push_pendencias() to service_role;

-- 2. push_acao com a tabela "agenda" (feito / adiar). O resto é igual à versão de 13/10.
create or replace function public.push_acao(p_recibo uuid, p_acao text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.push_recibos%rowtype;
  plano jsonb;
  linha record;
  ag public.agenda%rowtype;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  nova_hora time;
begin
  select * into r from push_recibos where recibo = p_recibo for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'recibo desconhecido'); end if;
  if r.acionado_em is not null then return jsonb_build_object('ok', true, 'motivo', 'ja respondido', 'resposta', r.acao); end if;
  plano := r.acoes -> p_acao;
  if plano is null then return jsonb_build_object('ok', false, 'motivo', 'botao sem plano'); end if;

  if plano ->> 'tabela' = 'duvidas_agente' then
    update duvidas_agente
       set status = 'respondida', resposta = plano ->> 'resposta', respondido_em = now()
     where id = (plano ->> 'id')::uuid and status = 'aberta'
     returning id, pergunta, cliente_id into linha;
    if not found then
      update push_recibos set acionado_em = now(), acao = p_acao where recibo = p_recibo;
      return jsonb_build_object('ok', true, 'motivo', 'cartao ja fechado no app');
    end if;
    insert into historico (o_que, por, detalhe)
    values ('Respondeu ao Claude pela notificação: ' || left(linha.pergunta, 80), 'diego',
            (plano ->> 'resposta') || coalesce(' · cliente ' || linha.cliente_id::text, ''));

  elsif plano ->> 'tabela' = 'agenda' then
    select * into ag from agenda where id = (plano ->> 'id')::uuid for update;
    if not found or ag.status <> 'planejado' then
      -- Já resolvido pelo app antes do toque: não mexe no que ele decidiu lá.
      update push_recibos set acionado_em = now(), acao = p_acao where recibo = p_recibo;
      return jsonb_build_object('ok', true, 'motivo', 'card ja resolvido no app');
    end if;
    if plano ->> 'resposta' = 'feito' then
      -- O MESMO CAMINHO do botão Feito do app: recado primeiro, depois o status (o banco recusa data futura).
      insert into agenda_recados (agenda_id, acao, texto)
      values (ag.id, 'feito', 'Feito pela notificação' || case when ag.data > hoje then ' [marcado para ' || ag.data || coalesce(' ' || to_char(ag.hora, 'HH24:MI'), '') || ']' else '' end);
      update agenda set status = 'feito', data = least(ag.data, hoje), nota_claude_conferida = true where id = ag.id;
      if ag.pessoal_id is not null then
        update pessoais set status = 'CONCLUIDO', concluido_em = now(), atualizado_em = now() where id = ag.pessoal_id and status = 'PENDENTE';
      end if;
      insert into historico (o_que, por, detalhe)
      values ('Feito pela notificação: ' || left(coalesce(ag.titulo, ''), 80), 'diego', 'agenda ' || ag.id::text);
    elsif plano ->> 'resposta' = 'adiar' then
      nova_hora := case when ag.hora >= time '23:00' then ag.hora else ag.hora + interval '1 hour' end;
      update agenda set hora = nova_hora where id = ag.id;
      insert into agenda_recados (agenda_id, acao, texto)
      values (ag.id, 'recado', 'Adiou 1 hora pela notificação (era ' || to_char(ag.hora, 'HH24:MI') || ', agora ' || to_char(nova_hora, 'HH24:MI') || ')');
      -- Solta as chaves de aviso: a nova hora lembra de novo (60 min antes e na hora).
      perform push_soltar(array['agenda:' || ag.id::text, 'agenda-hora:' || ag.id::text]);
      insert into historico (o_que, por, detalhe)
      values ('Adiou 1h pela notificação: ' || left(coalesce(ag.titulo, ''), 80), 'diego',
              'agenda ' || ag.id::text || ' · antes: ' || to_char(ag.hora, 'HH24:MI') || ' → depois: ' || to_char(nova_hora, 'HH24:MI'));
    else
      return jsonb_build_object('ok', false, 'motivo', 'resposta sem tratamento');
    end if;

  elsif plano ->> 'tabela' = 'teste' then
    null;
  else
    return jsonb_build_object('ok', false, 'motivo', 'tabela sem tratamento');
  end if;

  update push_recibos set acionado_em = now(), acao = p_acao where recibo = p_recibo;
  return jsonb_build_object('ok', true, 'resposta', plano ->> 'resposta');
end;
$$;
revoke execute on function public.push_acao(uuid, text) from public, anon, authenticated;
grant  execute on function public.push_acao(uuid, text) to service_role;

-- Conferência
select jsonb_array_length(public.push_pendencias() -> 'agenda_hoje') as hoje,
       jsonb_array_length(public.push_pendencias() -> 'agenda_na_hora') as na_hora;

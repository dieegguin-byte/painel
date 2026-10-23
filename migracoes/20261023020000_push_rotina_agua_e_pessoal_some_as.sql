-- AVISO NO CELULAR DA ROTINA FIXADA E DA ÁGUA, E ITEM PESSOAL QUE SOME SOZINHO (Diego, 23/10/2026).
-- "Quero que a notificação da rotina de água e comprar pão apareça aqui" (print do Feito/Adiar 1h) e
-- "buscar minha esposa e filho na escola, ela durar só até 18 horas e remover sozinha".
-- Uma instrução por vez, na ordem abaixo.

-- 1. Item pessoal com hora de sumir no próprio dia.
alter table public.pessoais add column if not exists some_as time;

-- 2. Buscar Raquel e Miguel na escola (17h30) vale até 18h.
update public.pessoais set some_as = '18:00' where titulo = 'Buscar Raquel e Miguel na escola' and status = 'PENDENTE';

-- 3. Passou da hora de sumir: o banco fecha a linha (o app já esconde na hora).
select cron.schedule('pessoal-some-sozinho', '*/15 * * * *', $$update public.pessoais set status = 'CONCLUIDO', concluido_em = now(), atualizado_em = now() where status = 'PENDENTE' and some_as is not null and data_alvo is not null and (data_alvo + some_as) <= (now() at time zone 'America/Sao_Paulo')$$);

-- 4. push_pendencias ganha rotinas_na_hora (fixadas no topo, vencidas, hora chegada, sem adiar) e agua (último copo).
CREATE OR REPLACE FUNCTION public.push_pendencias()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  'agenda_na_hora', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'titulo', coalesce(nullif(btrim(pe.titulo), ''), a.titulo), 'hora', to_char(a.hora,'HH24:MI'),
      'local', a.local, 'cidade', a.cidade, 'tipo', a.tipo, 'servico_id', a.servico_id,
      'cliente_id', coalesce(a.cliente_id, sv.cliente_id),
      'passaram', floor(extract(epoch from (agora.t - (a.data + a.hora)))/60)::int,
      'visto', exists (
        select 1 from push_recibos r
        where r.tag = 'agenda-' || a.id::text
          and r.enviado_em >= ((a.data + a.hora) at time zone 'America/Sao_Paulo') - interval '1 minute'
          and (r.aberto_em is not null or r.acionado_em is not null)
      )
    ) order by (a.data + a.hora))
    from agenda a
    left join pessoais pe on pe.id = a.pessoal_id
    left join servicos sv on sv.id = a.servico_id, agora
    where a.status = 'planejado' and a.hora is not null
      and (a.data + a.hora) <= agora.t
      and (a.data + a.hora) > agora.t - interval '30 minutes'
  ), '[]'::jsonb),
  'agenda_hoje', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'titulo', coalesce(nullif(btrim(pe.titulo), ''), a.titulo), 'hora', to_char(a.hora,'HH24:MI'),
      'cidade', a.cidade, 'tipo', a.tipo
    ) order by a.hora)
    from agenda a
    left join pessoais pe on pe.id = a.pessoal_id, hoje
    where a.status = 'planejado' and a.hora is not null and a.data = hoje.d
  ), '[]'::jsonb),
  'rotinas_na_hora', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'titulo', r.titulo,
      'hora', case when r.hora ~ '^[0-9]{2}:[0-9]{2}' then substr(r.hora, 1, 5) end,
      'adiada_ate', to_char(r.adiada_ate at time zone 'America/Sao_Paulo', 'HH24:MI')
    ) order by r.hora)
    from rotinas r, agora, hoje
    where r.ativo and r.fixar_topo
      and coalesce(greatest(r.ultima_execucao, r.nao_fiz_em) + coalesce(r.intervalo_dias, 1), hoje.d) <= hoje.d
      and case when r.hora ~ '^[0-9]{2}:[0-9]{2}' then (hoje.d + substr(r.hora, 1, 5)::time) <= agora.t else true end
      and (r.adiada_ate is null or r.adiada_ate <= now())
  ), '[]'::jsonb),
  'agua', (
    select case when max(w.bebi_em) is null then null else jsonb_build_object(
      'ultima', to_char(max(w.bebi_em) at time zone 'America/Sao_Paulo', 'HH24:MI'),
      'ultima_id', floor(extract(epoch from max(w.bebi_em)))::bigint,
      'minutos', floor(extract(epoch from (now() - max(w.bebi_em)))/60)::int
    ) end
    from agua w
  ),
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
$function$;

-- 5. push_acao aplica os botões novos: rotinas (feito/adiar, iguais aos do app) e agua (bebi).
CREATE OR REPLACE FUNCTION public.push_acao(p_recibo uuid, p_acao text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.push_recibos%rowtype;
  plano jsonb;
  linha record;
  ag public.agenda%rowtype;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  nova_hora time;
  rt_titulo text;
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
      update push_recibos set acionado_em = now(), acao = p_acao where recibo = p_recibo;
      return jsonb_build_object('ok', true, 'motivo', 'card ja resolvido no app');
    end if;
    -- Card de conta ainda aberta: não dá baixa por aqui. O recibo fica sem acionar e a notificação na barra.
    if plano ->> 'resposta' = 'feito' and ag.financeiro_id is not null
       and exists (select 1 from financeiro f where f.id = ag.financeiro_id and f.status in ('a_pagar', 'a_receber')) then
      return jsonb_build_object('ok', false, 'motivo', 'conta pede confirmacao no app',
                                'abrir', './nova.html?ir=card&id=' || ag.id::text || '&pagou=1');
    end if;
    if plano ->> 'resposta' = 'feito' then
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
      perform push_reservar(array['agenda:' || ag.id::text]);
      perform push_soltar(array['agenda-hora:' || ag.id::text]);
      insert into historico (o_que, por, detalhe)
      values ('Adiou 1h pela notificação: ' || left(coalesce(ag.titulo, ''), 80), 'diego',
              'agenda ' || ag.id::text || ' · antes: ' || to_char(ag.hora, 'HH24:MI') || ' → depois: ' || to_char(nova_hora, 'HH24:MI'));
    else
      return jsonb_build_object('ok', false, 'motivo', 'resposta sem tratamento');
    end if;

  elsif plano ->> 'tabela' = 'rotinas' then
    -- Os mesmos campos do ✓ Feito e do ⏰ Adiar 1h do RotinasCard no app.
    if plano ->> 'resposta' = 'feito' then
      update rotinas set ultima_execucao = hoje, adiada_ate = null
       where id = (plano ->> 'id')::uuid and ativo returning titulo into rt_titulo;
    elsif plano ->> 'resposta' = 'adiar' then
      update rotinas set adiada_ate = now() + interval '1 hour'
       where id = (plano ->> 'id')::uuid and ativo returning titulo into rt_titulo;
    else
      return jsonb_build_object('ok', false, 'motivo', 'resposta sem tratamento');
    end if;
    if rt_titulo is null then
      update push_recibos set acionado_em = now(), acao = p_acao where recibo = p_recibo;
      return jsonb_build_object('ok', true, 'motivo', 'rotina desativada');
    end if;
    insert into historico (o_que, por, detalhe)
    values (case when plano ->> 'resposta' = 'feito' then 'Rotina feita pela notificação: ' else 'Rotina adiada 1h pela notificação: ' end || left(rt_titulo, 80),
            'diego', 'rotina ' || (plano ->> 'id'));

  elsif plano ->> 'tabela' = 'agua' then
    -- Bebi: um copo. Se o Bebi do app já gravou um copo nos últimos 10 min, não conta duas vezes.
    if plano ->> 'resposta' <> 'bebi' then
      return jsonb_build_object('ok', false, 'motivo', 'resposta sem tratamento');
    end if;
    if not exists (select 1 from agua where bebi_em > now() - interval '10 minutes') then
      insert into agua default values;
    end if;

  elsif plano ->> 'tabela' = 'teste' then
    null;
  else
    return jsonb_build_object('ok', false, 'motivo', 'tabela sem tratamento');
  end if;

  update push_recibos set acionado_em = now(), acao = p_acao where recibo = p_recibo;
  return jsonb_build_object('ok', true, 'resposta', plano ->> 'resposta');
end;
$function$;

-- AVISO DO CELULAR IGUAL AO APP (Diego, 23/10/2026: "está atrasado em relação ao app", com o print do "Agora 13:05 ·
-- Buscar o sofá da Larissa" ainda na barra depois do Remarcar e do Manu resolve).
-- Card com toque pendente (Remarcar ou recado ainda não lidos em agenda_recados, ou Manu resolve que a Manu não pegou)
-- some do app; agora também não ganha aviso no celular. Mesma regra do app (someComToque no nova.html): a visita
-- (presencial) que ainda vai acontecer continua na tela e continua avisando antes; na hora, ou passou dela, some.
-- Só muda push_pendencias: as listas 'agenda' (o que vem nas próximas 6h) e 'agenda_na_hora' (chegou a hora).

CREATE OR REPLACE FUNCTION public.push_pendencias()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with agora as (select (now() at time zone 'America/Sao_Paulo') as t),
     hoje  as (select (now() at time zone 'America/Sao_Paulo')::date as d),
     com_toque as (
       select r.agenda_id as id from agenda_recados r
       where r.processado_em is null and r.acao in ('remarcar', 'recado')
       union
       select a.id from agenda a
       where a.status = 'planejado' and exists (
         select 1 from caixa_entrada c
         where c.processado is not true
           and c.conversa @> jsonb_build_array(jsonb_build_object('meta', jsonb_build_object('origem', 'manu_resolve', 'agenda_id', a.id::text))))
     ),
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
      and not (a.tipo is distinct from 'presencial' and exists (select 1 from com_toque ct where ct.id = a.id))
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
      and not exists (select 1 from com_toque ct where ct.id = a.id)
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

-- AVISO INSISTENTE NA HORA (Diego, 15/10/2026: "meu celular tá do meu lado, mas tá carregando" e o aviso passa
-- despercebido; esqueceu a Luana). Enquanto o card segue planejado e ele não tocou no aviso (corpo ou botão),
-- a varredura (a cada 5 min) manda o MESMO aviso de novo, até 5 vezes dentro dos 30 min: toca e vibra outra vez.
--
-- O que muda: push_pendencias.agenda_na_hora ganha `visto` = existe recibo da tag agenda-<id>, enviado depois
-- da hora do card, com aberto_em ou acionado_em. A função de push usa a chave agenda-hora:<id>:<n>
-- (n = passaram/5) e só repete quando visto = false. Idempotente.


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
      'cliente_id', coalesce(a.cliente_id, sv.cliente_id),
      'passaram', floor(extract(epoch from (agora.t - (a.data + a.hora)))/60)::int,
      -- VISTO (15/10/2026): ele tocou no corpo ou num botão de um aviso desta tag mandado depois da hora.
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

-- Conferência:
--   select jsonb_pretty(public.push_pendencias() -> 'agenda_na_hora');

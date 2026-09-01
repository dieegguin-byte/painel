-- O AGRUPAMENTO QUE NÃO AGRUPAVA — 01/09/2026
--
-- Na manhã de 31/08 o Diego recebeu CINCO lembretes de agenda separados: 07:00, 07:15, 07:45, 08:00
-- e 09:30. Era exatamente o que o agrupamento, escrito em 30/08, existia para impedir.
--
-- POR QUE FALHOU. O agrupamento funcionava — ele só nunca tinha dois itens para juntar. A varredura
-- roda a cada 5 minutos e a `push_pendencias` só devolvia quem já estava dentro da janela de 60 min.
-- Como os compromissos dele são espaçados de 15 em 15, cada varredura encontrava UM recém-chegado e
-- mandava sozinho. O defeito não estava em juntar: estava em olhar perto demais.
--
-- A CORREÇÃO. A função passa a devolver as próximas 6 HORAS, cada compromisso marcado com `na_janela`.
-- Quem decide o corte é a Edge Function (levaDaAgenda): dispara pelo primeiro que entrou na janela e
-- encadeia os seguintes enquanto o intervalo entre eles for de no máximo 60 min.
--
-- MEDIDO CONTRA OS DADOS REAIS daquela manhã, antes de publicar:
--   antes ..... 5 notificações separadas
--   depois .... 1 aviso "6 compromissos a partir das 08:00" (08:00, 08:15, 08:30, 08:30, 08:45, 09:00)
--               + 1 aviso individual às 09:30 para o compromisso das 10:30
-- O de 10:30 NÃO é arrastado junto — ele fica a 90 min do anterior, o encadeamento corta ali e ele
-- ganha o próprio lembrete na hora dele. Agrupar demais destruiria o sentido de ter lembrete.
--
-- ⚠ A Edge Function reserva SÓ a leva, nunca as 6 horas inteiras. Reservar tudo marcaria como
-- "já avisado" um compromisso que ninguém viu, e ele nunca receberia lembrete nenhum.

create or replace function public.push_pendencias() returns jsonb
language sql security definer set search_path = public as $$
with agora as (select (now() at time zone 'America/Sao_Paulo') as t),
     hoje  as (select (now() at time zone 'America/Sao_Paulo')::date as d)
select jsonb_build_object(
  'agora', (select t from agora),
  'hoje',  (select d from hoje),
  -- Próximas 6h, em ordem. `na_janela` marca quem já está dentro da hora que dispara o aviso.
  'agenda', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'titulo', a.titulo, 'hora', to_char(a.hora,'HH24:MI'),
      'local', a.local, 'cidade', a.cidade, 'tipo', a.tipo, 'servico_id', a.servico_id,
      'faltam', floor(extract(epoch from ((a.data + a.hora) - agora.t))/60)::int,
      'na_janela', ((a.data + a.hora) <= agora.t + interval '60 minutes')
    ) order by (a.data + a.hora))
    from agenda a, agora
    where a.status = 'planejado' and a.hora is not null
      and (a.data + a.hora) >= agora.t
      and (a.data + a.hora) <= agora.t + interval '6 hours'
  ), '[]'::jsonb),
  'caixa', coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'texto', left(c.texto, 160)))
    from caixa_entrada c
    where c.processado = false and c.criado_em > now() - interval '24 hours'
  ), '[]'::jsonb),
  'resumo', (select jsonb_build_object(
    'compromissos_hoje',  (select count(*) from agenda a,     hoje where a.status='planejado' and a.data = hoje.d and a.hora is not null),
    'proximo_hoje',       (select to_char(min(a.hora),'HH24:MI') from agenda a, hoje where a.status='planejado' and a.data = hoje.d and a.hora is not null),
    'retornos_vencidos',  (select count(*) from servicos s,    hoje where s.status in ('lead','orcamento') and s.prazo is not null and s.prazo < hoje.d),
    'contas_vencendo',    (select count(*) from financeiro f,  hoje where f.status='a_pagar' and f.data <= hoje.d + 3),
    'contas_valor',       (select coalesce(sum(f.valor),0)::numeric(12,2) from financeiro f, hoje where f.status='a_pagar' and f.data <= hoje.d + 3),
    'caixa_pendente',     (select count(*) from caixa_entrada where processado = false)
  ))
);
$$;
revoke execute on function public.push_pendencias() from public, anon, authenticated;
grant  execute on function public.push_pendencias() to service_role;

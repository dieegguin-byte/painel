-- ACERTO POR SERVIÇO COM O PROFISSIONAL — 06/10/2026
--
-- Atende o recado do Claude chat "Acerto por profissional no app" (06/10): acabar com a garimpagem nas
-- conversas na hora de acertar as contas com o tapeceiro.
--
-- O QUE FOI MEDIDO ANTES (06/10), porque o recado partia de "o app só guarda o vale":
--   - Os vínculos JÁ existiam: financeiro.profissional_id, financeiro.servico_id e servicos.profissional_id.
--   - O que NÃO existia em campo nenhum era o valor COMBINADO de mão de obra por serviço. O banco só guardava
--     o pagamento, depois do fato (27 linhas "Mão de obra" pagas, R$ 9.995) — por isso "quanto falta do sofá
--     de Fulano" só se respondia relendo o WhatsApp.
--   - Nenhum dos 31 vales tinha servico_id; só 7 tinham profissional_id.
--
-- 1. servicos.valor_mao_de_obra — a parte do profissional combinada por aquele serviço (não é o valor do
--    cliente, que continua em valor_orcamento). Nulo = ainda não anotado; zero = nada a pagar.
--
-- 2. v_acerto_profissional_servico — uma linha por serviço com profissional vinculado:
--        saldo = combinado − pagamentos − vales
--    contando SÓ lançamento que tem o MESMO servico_id E o MESMO profissional_id. Caso real que obriga a
--    regra: o serviço da Renata tinha R$ 300 pagos ao Marlom Júnior e R$ 100 ao marceneiro, todos com o mesmo
--    servico_id. Somar só por serviço diria que o Marlom recebeu R$ 400. O que está no serviço sem dizer de
--    quem é sai na coluna `no_servico_sem_profissional` e não entra em saldo nenhum.
--
-- 3. v_acerto_profissional — o total por pessoa: o que falta nos serviços em aberto, mais trabalho avulso
--    anotado, menos vale solto. Vale solto = sem [ABATIDO] e fora de um serviço do próprio profissional: ele
--    desconta do TOTAL da pessoa, nunca de um serviço escolhido por suposição.
--
-- O app faz a mesma conta em montarAcertoProfissionais() (nova.html). Mudou uma, muda a outra.
-- Nada aqui mexe em dado existente: uma coluna nula e duas views de leitura.

alter table public.servicos add column if not exists valor_mao_de_obra numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'servicos_valor_mao_de_obra_nao_negativo') then
    alter table public.servicos add constraint servicos_valor_mao_de_obra_nao_negativo
      check (valor_mao_de_obra is null or valor_mao_de_obra >= 0);
  end if;
end $$;

comment on column public.servicos.valor_mao_de_obra is
  'Mão de obra COMBINADA com o profissional (profissional_id) por este serviço. Não é o valor do cliente. Nulo = não anotado. O saldo sai em v_acerto_profissional_servico.';

create or replace view public.v_acerto_profissional_servico
with (security_invoker = true) as
select
  s.profissional_id,
  p.nome as profissional,
  s.id as servico_id,
  c.nome as cliente,
  s.titulo,
  s.status as status_servico,
  s.prazo,
  s.valor_mao_de_obra as combinado,
  coalesce(l.pago, 0) as pago,
  coalesce(l.vales, 0) as vales,
  case when s.valor_mao_de_obra is null then null
       else round(s.valor_mao_de_obra - coalesce(l.pago, 0) - coalesce(l.vales, 0), 2) end as saldo,
  case when s.valor_mao_de_obra is null then 'sem_valor'
       when s.valor_mao_de_obra - coalesce(l.pago, 0) - coalesce(l.vales, 0) > 0 then 'aberto'
       else 'quitado' end as situacao,
  coalesce(l.sem_profissional, 0) as no_servico_sem_profissional
from public.servicos s
join public.profissionais p on p.id = s.profissional_id
left join public.clientes c on c.id = s.cliente_id
left join lateral (
  select
    sum(f.valor) filter (where f.profissional_id = s.profissional_id
                           and f.categoria = 'Mão de obra' and f.status = 'pago') as pago,
    sum(f.valor) filter (where f.profissional_id = s.profissional_id
                           and f.categoria = 'Vale') as vales,
    sum(f.valor) filter (where f.profissional_id is null
                           and ((f.categoria = 'Mão de obra' and f.status = 'pago') or f.categoria = 'Vale')) as sem_profissional
  from public.financeiro f
  where f.servico_id = s.id
) l on true;

comment on view public.v_acerto_profissional_servico is
  'Acerto por serviço: combinado − pagamentos − vales, só com lançamento do mesmo serviço E do mesmo profissional. situacao: sem_valor | aberto | quitado.';

create or replace view public.v_acerto_profissional
with (security_invoker = true) as
select
  p.id as profissional_id,
  p.nome as profissional,
  coalesce(sv.servicos_abertos, 0) as servicos_abertos,
  coalesce(sv.falta_servicos, 0) as falta_servicos,
  coalesce(sv.servicos_sem_valor, 0) as servicos_sem_valor,
  coalesce(av.trabalhos_avulsos, 0) as trabalhos_avulsos,
  coalesce(vl.vales_soltos, 0) as vales_soltos,
  round(coalesce(sv.falta_servicos, 0) + coalesce(av.trabalhos_avulsos, 0) - coalesce(vl.vales_soltos, 0), 2) as total_a_acertar,
  coalesce(ps.pagos_sem_servico, 0) as pagos_sem_servico
from public.profissionais p
left join lateral (
  select
    count(*) filter (where a.situacao = 'aberto') as servicos_abertos,
    sum(a.saldo) filter (where a.situacao = 'aberto') as falta_servicos,
    -- "Sem valor" só conta o que pede ação: serviço em andamento, ou encerrado que já tem dinheiro amarrado.
    count(*) filter (where a.situacao = 'sem_valor'
                       and (a.status_servico in ('agendado', 'producao', 'pronto') or a.pago + a.vales > 0)) as servicos_sem_valor
  from public.v_acerto_profissional_servico a
  where a.profissional_id = p.id
) sv on true
left join lateral (
  select sum(f.valor) as trabalhos_avulsos
  from public.financeiro f
  where f.profissional_id = p.id and f.categoria = 'Mão de obra' and f.status = 'a_pagar'
    and coalesce(f.descricao, '') not like '[ACERTADO]%'
) av on true
left join lateral (
  select sum(f.valor) as vales_soltos
  from public.financeiro f
  where f.profissional_id = p.id and f.categoria = 'Vale'
    and coalesce(f.descricao, '') not like '[ABATIDO]%'
    and not exists (select 1 from public.servicos s where s.id = f.servico_id and s.profissional_id = p.id)
) vl on true
left join lateral (
  select sum(f.valor) as pagos_sem_servico
  from public.financeiro f
  where f.profissional_id = p.id and f.categoria = 'Mão de obra' and f.status = 'pago'
    and not exists (select 1 from public.servicos s where s.id = f.servico_id and s.profissional_id = p.id)
) ps on true;

comment on view public.v_acerto_profissional is
  'Total por profissional: falta_servicos + trabalhos_avulsos − vales_soltos. pagos_sem_servico é só informação: pagamento sem serviço não entra em saldo nenhum.';

-- CONFERÊNCIA: a coluna existe e as duas views respondem.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'servicos' and column_name = 'valor_mao_de_obra') as coluna_criada,
  (select count(*) from public.v_acerto_profissional_servico) as linhas_por_servico,
  (select count(*) from public.v_acerto_profissional) as profissionais;

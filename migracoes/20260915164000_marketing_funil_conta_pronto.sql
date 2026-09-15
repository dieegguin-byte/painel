-- vw_marketing_funil passa a contar o status 'pronto' (entrou em 15/09/2026).
-- Colunas novas no FIM, sem mudar as existentes: quem já lê a view continua funcionando.
-- security_invoker precisa ser repetido: CREATE OR REPLACE VIEW substitui as opções da view.
-- Aplicada em produção pelo Claude em 15/09/2026 (migração `marketing_funil_conta_pronto`).
create or replace view public.vw_marketing_funil
with (security_invoker = true) as
select coalesce(nullif(origem_plataforma, ''), 'nao_identificada') as origem_plataforma,
  origem_campanha_id,
  origem_campanha_nome,
  landing_page,
  count(*) as qtd_total,
  count(*) filter (where status = 'lead') as qtd_lead,
  count(*) filter (where status = 'orcamento') as qtd_orcamento,
  count(*) filter (where status = 'agendado') as qtd_agendado,
  count(*) filter (where status = 'producao') as qtd_producao,
  count(*) filter (where status = 'entregue') as qtd_entregue,
  count(*) filter (where status = 'pago') as qtd_pago,
  count(*) filter (where status = 'perdido') as qtd_perdido,
  coalesce(sum(valor_orcamento), 0::numeric) as valor_orcamento_total,
  coalesce(sum(valor_orcamento) filter (where status = 'orcamento'), 0::numeric) as valor_em_orcamento,
  coalesce(sum(valor_orcamento) filter (where status = 'producao'), 0::numeric) as valor_em_producao,
  coalesce(sum(valor_orcamento) filter (where status = 'entregue'), 0::numeric) as valor_entregue,
  count(*) filter (where status = 'pronto') as qtd_pronto,
  coalesce(sum(valor_orcamento) filter (where status = 'pronto'), 0::numeric) as valor_pronto
from public.servicos
where tracking_ref is not null or origem_campanha_id is not null or origem_plataforma is not null
   or gclid is not null or gbraid is not null or wbraid is not null or utm_source is not null
group by coalesce(nullif(origem_plataforma, ''), 'nao_identificada'), origem_campanha_id, origem_campanha_nome, landing_page;

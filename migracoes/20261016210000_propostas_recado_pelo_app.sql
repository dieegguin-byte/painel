-- Proposta em "recado" só aparece no quadro do Diego quando o recado foi dele, pelo app (16/10/2026: a da Luana
-- Regina, segurada pelo orçamento, parecia um follow-up enviado). Aplicado por execute_sql em 16/10.
alter table public.propostas add column if not exists recado_pelo_app boolean not null default false;

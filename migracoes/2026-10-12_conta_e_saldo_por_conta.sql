-- Já aplicada em produção em 12/10/2026 (Diego: "ajuste no financeiro no app mesmo").
-- Cada lançamento pode dizer em qual conta caiu; cada conta tem um saldo inicial.
alter table public.financeiro add column if not exists conta text;
alter table public.financeiro drop constraint if exists financeiro_conta_check;
alter table public.financeiro add constraint financeiro_conta_check
  check (conta is null or conta in ('nubank_pj','nubank_pf','infinitepay','dinheiro_pj','dinheiro_pessoal'));

create table if not exists public.contas_saldo (
  conta text primary key check (conta in ('nubank_pj','nubank_pf','infinitepay','dinheiro_pj','dinheiro_pessoal')),
  nome text not null,
  saldo_inicial numeric(12,2),
  data_inicial date,
  atualizado_em timestamptz default now()
);
alter table public.contas_saldo enable row level security;
create policy operador_autorizado on public.contas_saldo for all to authenticated
  using ((select usuario_autorizado())) with check ((select usuario_autorizado()));

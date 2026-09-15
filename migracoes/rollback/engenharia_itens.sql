-- Rollback operacional conservador do cronograma tecnico.
-- Retirar a consulta e a UI do cronograma no app antes/depois deste script.
-- Preserva tabela, dados, constraints, RLS e acesso service_role para recuperacao.
-- Pode ser repetido. Para reativar, reaplicar a migracao do cronograma.
begin;

do $rollback$
begin
  if to_regclass('public.engenharia_itens') is not null then
    revoke all on table public.engenharia_itens from public, anon, authenticated;
  end if;
end;
$rollback$;

commit;

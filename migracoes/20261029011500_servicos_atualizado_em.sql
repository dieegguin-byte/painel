-- Data de "mexido por último" dos serviços se atualiza sozinha em toda alteração (Diego "publica", via Toqi no Mural, 28/10/2026 21h30).
-- Antes só mudava quando quem alterava lembrava de pôr atualizado_em (a Carmem ficou com 24/10 depois de ganhar valor e envio em 27/10).
create or replace function private.trg_servicos_atualizado_em() returns trigger language plpgsql set search_path = '' as $f$ begin new.atualizado_em := now(); return new; end $f$;
create trigger servicos_atualizado_em before update on public.servicos for each row execute function private.trg_servicos_atualizado_em();

-- Reversão do gatilho "Toqi mudou, Diego confere" (20261102230000_toqi_mudou_card_pra_conferir.sql).
-- Não apaga nota nenhuma: card já marcado continua com o selo até o Diego tocar "Entendi, tá certo".
drop trigger if exists agenda_toqi_mudou_conferir on public.agenda;
drop function if exists private.trg_agenda_toqi_mudou_conferir();
select count(*) as gatilhos_restantes from pg_trigger where tgname = 'agenda_toqi_mudou_conferir';

-- Reversão da coluna agenda.saida (20261103050000_agenda_saida.sql). Perde só as ligações de saída gravadas; os cards ficam.
alter table public.agenda drop column if exists saida;
select count(*) as colunas_restantes from information_schema.columns where table_schema = 'public' and table_name = 'agenda' and column_name = 'saida';

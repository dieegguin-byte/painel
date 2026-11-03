-- Mesma saída (Diego, 03/11/2026: "um card ficar da mesma coisa do outro sendo para o mesmo destino nao esta dando certo").
-- Coluna nova, sem apagar nada: agenda.saida guarda o id do primeiro card da saída. Cards com a mesma saída e a mesma data
-- aparecem ligados no app (ligacoesDaLista), com qualquer hora e cidade. O primeiro card pode ficar com saida vazia.
-- Card apagado (raro, a regra é cancelar) solta os outros da saída em vez de travar o delete.
alter table public.agenda add column if not exists saida uuid references public.agenda(id) on delete set null;
comment on column public.agenda.saida is 'Id do primeiro card da mesma saída (viagem). Mesma saída + mesma data = cards ligados no app. Vazio = card solto. 03/11/2026.';
select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = 'agenda' and column_name = 'saida';

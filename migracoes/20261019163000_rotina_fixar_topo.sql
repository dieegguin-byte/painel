-- ROTINA FIXADA NO TOPO (Diego, 19/10/2026). No dia dela, a rotina com fixar_topo sai do meio da lista e fica num card
-- próprio no alto do Painel até ser feita. Aplicado em 19/10/2026, uma instrução por vez.
alter table public.rotinas add column if not exists fixar_topo boolean not null default false;
update public.rotinas set fixar_topo = true where id = '5aa17974-bdd3-4131-9763-b141b8b4aec3';

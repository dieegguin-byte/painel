-- A TOQI NO APP E O MURAL DE RECADOS (Diego, 26/10/2026: "Sim e avise ele" pro autor 'toqi', e "Vamos fazer uma
-- comunicação dentro do próprio app de você e da Toqi"). Uma instrução por vez, nesta ordem.
--
-- historico.por passa a aceitar 'toqi': ela faz o dia a dia no lugar do Grok desde 26/10. Troca numa instrução só,
-- pra não ficar nem um instante sem a trava.
alter table public.historico drop constraint historico_por_check, add constraint historico_por_check check (por in ('diego', 'claude', 'grok', 'toqi'));

-- MURAL: recado entre Claude, Toqi, Grok e Diego (o Grok entrou a pedido do Diego, 26/10 11h18). lido_em é o "Li" de quem recebeu (é assim que o Claude sabe que ela leu).
create table if not exists public.mural_recados (id uuid primary key default gen_random_uuid(), de text not null check (de in ('claude', 'toqi', 'grok', 'diego')), para text not null check (para in ('claude', 'toqi', 'grok', 'diego', 'todos')), texto text not null check (length(btrim(texto)) > 0), responde_a uuid references public.mural_recados(id), criado_em timestamptz not null default now(), lido_em timestamptz, lido_por text check (lido_por is null or lido_por in ('claude', 'toqi', 'grok', 'diego')));

create index if not exists mural_recados_para_lido on public.mural_recados (para, lido_em);

create index if not exists mural_recados_criado on public.mural_recados (criado_em desc);

alter table public.mural_recados enable row level security;

create policy mural_recados_autorizado on public.mural_recados for all to authenticated using ((select public.usuario_autorizado())) with check ((select public.usuario_autorizado()));

comment on table public.mural_recados is 'Mural de recados entre Claude, Toqi, Grok e Diego. Nao e ordem de dinheiro nem de envio a cliente.';

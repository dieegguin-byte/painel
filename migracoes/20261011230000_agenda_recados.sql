-- CARDS DA AGENDA COM AÇÕES (Diego, 11/10/2026). Feito / Remarcar / Cancelar / recado (texto + áudio)
-- em cada card. A rotina do Claude (8h, 12h, 16h, 18h BRT) lê só os recados com processado_em nulo.
create table if not exists public.agenda_recados (
  id uuid primary key default gen_random_uuid(),
  agenda_id uuid not null references public.agenda(id) on delete cascade,
  acao text not null default 'recado' check (acao in ('recado','feito','remarcar','cancelar')),
  texto text,
  audio_path text,
  criado_em timestamptz not null default now(),
  processado_em timestamptz,
  resultado text
);
create index if not exists agenda_recados_agenda_idx on public.agenda_recados (agenda_id);
create index if not exists agenda_recados_abertos_idx on public.agenda_recados (criado_em) where processado_em is null;
alter table public.agenda_recados enable row level security;
drop policy if exists operador_autorizado on public.agenda_recados;
create policy operador_autorizado on public.agenda_recados for all to authenticated
  using ((select usuario_autorizado())) with check ((select usuario_autorizado()));
revoke all on public.agenda_recados from anon;
grant select, insert, update, delete on public.agenda_recados to authenticated;

-- Nota que o Claude deixa no card ("Remarcado pelo Claude — motivo"). Enquanto conferida = false, o card
-- mostra o selo amarelo com Manter/Mudar.
alter table public.agenda add column if not exists nota_claude text;
alter table public.agenda add column if not exists nota_claude_em timestamptz;
alter table public.agenda add column if not exists nota_claude_conferida boolean not null default true;

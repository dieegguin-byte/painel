-- DÚVIDAS DO AGENTE (Diego, 12/10/2026: "um local onde se o Agente tiver dúvidas ele me perguntar e eu
-- responder lá, para a próxima vez ele pegar").
--
-- Fluxo: o agente do WhatsApp (rotina de hora em hora) grava a pergunta aqui (status 'aberta', com `opcoes`
-- curtas quando cabe e `cliente_id` quando é sobre alguém). O Painel mostra o card "Dúvidas do agente"; o
-- Diego responde do celular (status 'respondida', `resposta`, `vale_sempre`). Na rodada seguinte o agente lê,
-- aplica no caso, marca 'aplicada' e, se vale_sempre, escreve em `regra` a versão geral — que ele relê em
-- TODA rodada antes de decidir qualquer coisa. "Não vale mais" no Painel só zera vale_sempre; nada é apagado.
--
-- APLICADA em 12/10/2026 pelo Claude Projetos (Supabase MCP), um comando por vez. Idempotente.
create table if not exists public.duvidas_agente (
  id uuid primary key default gen_random_uuid(),
  pergunta text not null,
  contexto text,
  opcoes jsonb not null default '[]'::jsonb,
  cliente_id uuid references public.clientes(id) on delete set null,
  referencia text,
  resposta text,
  vale_sempre boolean not null default false,
  regra text,
  status text not null default 'aberta' check (status in ('aberta','respondida','aplicada','descartada')),
  origem text not null default 'agente',
  criado_em timestamptz not null default now(),
  respondido_em timestamptz,
  aplicado_em timestamptz
);
-- plano (12/10, mesmo dia): o que fazer em cada opção, escrito por quem perguntou (ex.: a auditoria):
-- {"Feito":"agenda <id> → feito","Remarcar":"pedir data e remarcar"}. O agente da hora executa o plano da opção escolhida.
alter table public.duvidas_agente add column if not exists plano jsonb not null default '{}'::jsonb;
create index if not exists duvidas_agente_abertas_idx on public.duvidas_agente (criado_em) where status in ('aberta','respondida');
alter table public.duvidas_agente enable row level security;
drop policy if exists operador_autorizado on public.duvidas_agente;
create policy operador_autorizado on public.duvidas_agente for all to authenticated
  using ((select usuario_autorizado())) with check ((select usuario_autorizado()));
revoke all on public.duvidas_agente from anon;
grant select, insert, update, delete on public.duvidas_agente to authenticated;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'duvidas_agente') then
    alter publication supabase_realtime add table public.duvidas_agente;
  end if;
end $$;
-- Conferência
select relrowsecurity as rls, (select count(*) from pg_policies where tablename = 'duvidas_agente') as politicas,
  (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'duvidas_agente') as realtime
from pg_class where oid = 'public.duvidas_agente'::regclass;

-- DISTÂNCIAS SAEM DO CÓDIGO E VÃO PRO BANCO — 27/08/2026
-- Decidido com o Diego em 24/07/2026, parado desde então porque o console do Supabase caiu.
--
-- POR QUE: os tempos de estrada moravam na const TEMPO_ESTRADA_MIN, dentro do nova.html. Cidade nova
-- significava editar código e publicar. Ideia dele: "todo dia quando eu falar tenho compromisso em tal
-- lugar, você já vai atualizando" — a tabela não precisa nascer completa, engorda sozinha na operação.
-- Par que não existe cai num default cego de 60 min, e foi isso que fez a rota de 24/07 não bater.
--
-- FORMATO: cidade_a e cidade_b em ordem alfabética, minúsculas e sem acento — é o que cidadeChave()
-- produz no app. Fora desse formato o par não é encontrado e volta o default cego.
--
-- SEMENTE: os 35 pares que existem no código hoje (o rascunho de 24/07 tinha 26; os 9 de Taguatinga
-- entraram em 30/07 por causa dos cinco fornecedores de tecido de lá). Extraídos do próprio nova.html,
-- não redigitados.

create table if not exists public.distancias (
  id uuid primary key default gen_random_uuid(),
  cidade_a text not null,
  cidade_b text not null,
  minutos int not null check (minutos >= 0),
  criado_em timestamptz not null default now(),
  unique (cidade_a, cidade_b)
);

-- MESMA TRAVA DO RESTO DO BANCO (27/08): estar logado não basta, tem que estar em usuarios_autorizados.
-- O rascunho de 24/07 trazia `using (true)` — que é exatamente o padrão fraco removido hoje de 12 tabelas.
alter table public.distancias enable row level security;
drop policy if exists distancias_rw on public.distancias;
drop policy if exists operador_autorizado on public.distancias;
create policy operador_autorizado on public.distancias for all to authenticated
  using ((select usuario_autorizado())) with check ((select usuario_autorizado()));

insert into public.distancias (cidade_a, cidade_b, minutos) values
  ('brasilia','luziania',75),
  ('luziania','valparaiso',25),
  ('cidade ocidental','luziania',30),
  ('luziania','novo gama',35),
  ('jardim inga','luziania',15),
  ('aguas lindas de goias','luziania',105),
  ('aguas claras','luziania',60),
  ('aguas claras','brasilia',25),
  ('brasilia','valparaiso',45),
  ('brasilia','novo gama',50),
  ('brasilia','cidade ocidental',50),
  ('aguas lindas de goias','brasilia',50),
  ('novo gama','valparaiso',15),
  ('cidade ocidental','valparaiso',15),
  ('cidade ocidental','novo gama',20),
  ('luziania','riacho fundo',50),
  ('riacho fundo','valparaiso',30),
  ('aguas claras','riacho fundo',20),
  ('brasilia','riacho fundo',25),
  ('novo gama','riacho fundo',30),
  ('cidade ocidental','riacho fundo',45),
  ('aguas lindas de goias','riacho fundo',60),
  ('aguas claras','valparaiso',40),
  ('aguas claras','novo gama',45),
  ('aguas claras','cidade ocidental',55),
  ('aguas claras','aguas lindas de goias',60),
  ('luziania','taguatinga',60),
  ('aguas claras','taguatinga',10),
  ('brasilia','taguatinga',25),
  ('taguatinga','valparaiso',45),
  ('novo gama','taguatinga',45),
  ('cidade ocidental','taguatinga',55),
  ('riacho fundo','taguatinga',20),
  ('aguas lindas de goias','taguatinga',40),
  ('jardim inga','taguatinga',55)
on conflict (cidade_a, cidade_b) do nothing;

notify pgrst, 'reload schema';

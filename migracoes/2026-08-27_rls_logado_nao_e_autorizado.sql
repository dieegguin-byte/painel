-- ESTAR LOGADO NÃO É SER AUTORIZADO — 27/08/2026
--
-- O FURO: doze tabelas liberavam tudo com `auth.role() = 'authenticated'`, e a `rotinas` com `true` puro.
-- Quer dizer: bastava estar logado, não precisava estar autorizado. Como a publishable key mora dentro do
-- nova.html publicado, e o projeto está com cadastro aberto (disable_signup: false), qualquer pessoa podia
-- criar conta com o próprio e-mail, confirmar pelo link, e a partir daí LER E ESCREVER a operação inteira.
--
-- REPRODUZIDO ANTES DE MEXER (sessão simulada com uid inventado, dentro de transação com rollback):
--   clientes 138 · financeiro 365 · servicos 134 · pessoais 1
--   fornecedores 0 · github_change_requests 0   <- essas duas já usavam a trava certa
--
-- A CORREÇÃO não inventa regra nova: aplica nas 12 tabelas o MESMO padrão que já roda em produção nas
-- outras quatro (estoque, estoque_movimentos, fornecedores, github_change_requests) — usuario_autorizado(),
-- que exige o uid estar na lista usuarios_autorizados.
--
-- POR QUE NÃO QUEBRA: existe 1 conta no auth (dieegguin@gmail.com) e ela é exatamente a única da lista de
-- autorizados (uid 0acbc242-… casa nos dois lados). O service_role continua passando por cima do RLS, então
-- Edge Function e a ponte do GitHub não sentem nada.
--
-- SEGUNDA CAMADA, no painel do Supabase e não aqui: Authentication -> Sign In / Providers -> desligar
-- "Allow new users to sign up". Login por link mágico de conta existente continua funcionando.

begin;

drop policy if exists "auth_all" on public.agenda;
create policy "operador_autorizado" on public.agenda for all to authenticated
  using ((select usuario_autorizado())) with check ((select usuario_autorizado()));

drop policy if exists "auth_all" on public.caixa_entrada;
create policy "operador_autorizado" on public.caixa_entrada for all to authenticated
  using ((select usuario_autorizado())) with check ((select usuario_autorizado()));

drop policy if exists "auth_all" on public.clientes;
create policy "operador_autorizado" on public.clientes for all to authenticated
  using ((select usuario_autorizado())) with check ((select usuario_autorizado()));

drop policy if exists "auth_all" on public.config;
create policy "operador_autorizado" on public.config for all to authenticated
  using ((select usuario_autorizado())) with check ((select usuario_autorizado()));

drop policy if exists "dividas_authenticated_all" on public.dividas;
create policy "operador_autorizado" on public.dividas for all to authenticated
  using ((select usuario_autorizado())) with check ((select usuario_autorizado()));

drop policy if exists "auth_all" on public.financeiro;
create policy "operador_autorizado" on public.financeiro for all to authenticated
  using ((select usuario_autorizado())) with check ((select usuario_autorizado()));

drop policy if exists "auth_all" on public.fotos;
create policy "operador_autorizado" on public.fotos for all to authenticated
  using ((select usuario_autorizado())) with check ((select usuario_autorizado()));

drop policy if exists "auth_all" on public.guia_ia;
create policy "operador_autorizado" on public.guia_ia for all to authenticated
  using ((select usuario_autorizado())) with check ((select usuario_autorizado()));

drop policy if exists "auth_all" on public.historico;
create policy "operador_autorizado" on public.historico for all to authenticated
  using ((select usuario_autorizado())) with check ((select usuario_autorizado()));

drop policy if exists "auth_all" on public.pessoais;
create policy "operador_autorizado" on public.pessoais for all to authenticated
  using ((select usuario_autorizado())) with check ((select usuario_autorizado()));

drop policy if exists "auth_all" on public.servicos;
create policy "operador_autorizado" on public.servicos for all to authenticated
  using ((select usuario_autorizado())) with check ((select usuario_autorizado()));

-- rotinas era o caso mais aberto de todos: using (true) with check (true).
drop policy if exists "auth_all" on public.rotinas;
create policy "operador_autorizado" on public.rotinas for all to authenticated
  using ((select usuario_autorizado())) with check ((select usuario_autorizado()));

commit;

-- ============================================================================
-- CONFERÊNCIA (rodar depois; não altera nada)
-- O estranho tem que dar 0 em tudo. Se der qualquer número, NÃO ficou protegido.
-- ============================================================================
-- begin;
-- set local role authenticated;
-- set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aud":"authenticated"}';
-- select 'clientes' t, count(*) from clientes
--   union all select 'financeiro', count(*) from financeiro
--   union all select 'servicos', count(*) from servicos
--   union all select 'agenda', count(*) from agenda
--   union all select 'pessoais', count(*) from pessoais
--   union all select 'rotinas', count(*) from rotinas;
-- rollback;

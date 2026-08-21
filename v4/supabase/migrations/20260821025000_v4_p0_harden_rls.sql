-- Operacao Bahia V4 - P0 hardening de autorizacao
-- VALIDADO PRIMEIRO NO STAGING. NAO APLICAR EM PRODUCAO SEM AUTORIZACAO E TESTE DE COMPATIBILIDADE V3.

-- 1) Helper de autorizacao deixa de contornar RLS.
create or replace function public.usuario_autorizado()
returns boolean
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1
    from public.usuarios_autorizados u
    where u.user_id = (select auth.uid())
  );
$function$;

-- 2) Funcoes de trigger nao sao RPCs publicas.
revoke execute on function public.gcr_dispara_executor() from public, anon, authenticated;
revoke execute on function public.gcr_protege_concluido() from public, anon, authenticated;
revoke execute on function public.gcr_valida_pedido() from public, anon, authenticated;
revoke execute on function public.trava_agenda_feito_no_futuro() from public, anon, authenticated;
revoke execute on function public.trava_caixa_print_precisa_ser_lido() from public, anon, authenticated;
revoke execute on function public.usuario_autorizado() from public, anon;
grant execute on function public.usuario_autorizado() to authenticated, service_role;

-- 3) Remove policies legadas amplas.
drop policy if exists auth_all on public.agenda;
drop policy if exists auth_all on public.caixa_entrada;
drop policy if exists auth_all on public.clientes;
drop policy if exists auth_all on public.config;
drop policy if exists dividas_authenticated_all on public.dividas;
drop policy if exists auth_all on public.estoque;
drop policy if exists auth_all on public.financeiro;
drop policy if exists operador_autorizado on public.fornecedores;
drop policy if exists auth_all on public.fotos;
drop policy if exists operador_autorizado on public.github_change_requests;
drop policy if exists auth_all on public.guia_ia;
drop policy if exists auth_all on public.historico;
drop policy if exists auth_all on public.rotinas;
drop policy if exists auth_all on public.servicos;

-- 4) Menor privilegio no Data API.
revoke all on table public.agenda, public.caixa_entrada, public.clientes, public.config,
  public.dividas, public.estoque, public.financeiro, public.fornecedores, public.fotos,
  public.github_change_requests, public.guia_ia, public.historico, public.marketing_atribuicoes,
  public.rotinas, public.servicos, public.usuarios_autorizados from anon;

revoke all on table public.agenda, public.caixa_entrada, public.clientes, public.config,
  public.dividas, public.estoque, public.financeiro, public.fornecedores, public.fotos,
  public.github_change_requests, public.guia_ia, public.historico, public.marketing_atribuicoes,
  public.rotinas, public.servicos, public.usuarios_autorizados from authenticated;

grant select, insert, update, delete on table public.agenda, public.caixa_entrada, public.clientes,
  public.config, public.dividas, public.estoque, public.financeiro, public.fornecedores,
  public.fotos, public.guia_ia, public.historico, public.rotinas, public.servicos to authenticated;
grant select, insert on table public.github_change_requests to authenticated;
grant select on table public.marketing_atribuicoes, public.usuarios_autorizados to authenticated;

grant all on table public.agenda, public.caixa_entrada, public.clientes, public.config,
  public.dividas, public.estoque, public.financeiro, public.fornecedores, public.fotos,
  public.github_change_requests, public.guia_ia, public.historico, public.marketing_atribuicoes,
  public.rotinas, public.servicos, public.usuarios_autorizados to service_role;

-- 5) Cada operador autenticado precisa constar em usuarios_autorizados.
create policy operador_autorizado on public.agenda for all to authenticated
  using ((select public.usuario_autorizado())) with check ((select public.usuario_autorizado()));
create policy operador_autorizado on public.caixa_entrada for all to authenticated
  using ((select public.usuario_autorizado())) with check ((select public.usuario_autorizado()));
create policy operador_autorizado on public.clientes for all to authenticated
  using ((select public.usuario_autorizado())) with check ((select public.usuario_autorizado()));
create policy operador_autorizado on public.config for all to authenticated
  using ((select public.usuario_autorizado())) with check ((select public.usuario_autorizado()));
create policy operador_autorizado on public.dividas for all to authenticated
  using ((select public.usuario_autorizado())) with check ((select public.usuario_autorizado()));
create policy operador_autorizado on public.estoque for all to authenticated
  using ((select public.usuario_autorizado())) with check ((select public.usuario_autorizado()));
create policy operador_autorizado on public.financeiro for all to authenticated
  using ((select public.usuario_autorizado())) with check ((select public.usuario_autorizado()));
create policy operador_autorizado on public.fornecedores for all to authenticated
  using ((select public.usuario_autorizado())) with check ((select public.usuario_autorizado()));
create policy operador_autorizado on public.fotos for all to authenticated
  using ((select public.usuario_autorizado())) with check ((select public.usuario_autorizado()));
create policy operador_autorizado on public.guia_ia for all to authenticated
  using ((select public.usuario_autorizado())) with check ((select public.usuario_autorizado()));
create policy operador_autorizado on public.historico for all to authenticated
  using ((select public.usuario_autorizado())) with check ((select public.usuario_autorizado()));
create policy operador_autorizado on public.rotinas for all to authenticated
  using ((select public.usuario_autorizado())) with check ((select public.usuario_autorizado()));
create policy operador_autorizado on public.servicos for all to authenticated
  using ((select public.usuario_autorizado())) with check ((select public.usuario_autorizado()));

-- Ponte: usuario cria/le pedido; executor service_role faz atualizacoes.
create policy operador_le_github_requests on public.github_change_requests for select to authenticated
  using ((select public.usuario_autorizado()));
create policy operador_cria_github_requests on public.github_change_requests for insert to authenticated
  with check ((select public.usuario_autorizado()));

-- Marketing: frontend V4 apenas le; captura continua server-side.
create policy operador_le_marketing on public.marketing_atribuicoes for select to authenticated
  using ((select public.usuario_autorizado()));

-- View security_invoker ja existe; Data API somente leitura autenticada.
revoke all on table public.vw_marketing_funil from anon, authenticated;
grant select on table public.vw_marketing_funil to authenticated;
grant all on table public.vw_marketing_funil to service_role;

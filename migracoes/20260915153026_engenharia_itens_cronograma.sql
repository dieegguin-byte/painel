-- Cronograma tecnico: cada item aponta para seu recado e suas evidencias no Drive.
-- Sem sementes, cron, realtime, RPC, FK ou alteracao de tabelas de negocio.
-- Arquivo criado por Supabase CLI 2.117.0: migration new engenharia_itens_cronograma.
begin;

create table if not exists public.engenharia_itens (
  item_id text primary key,
  descricao text not null,
  prioridade text,
  fase_id text,
  criado_em timestamptz not null default now(),
  enviado_em timestamptz,
  estado text not null default 'a_fazer',
  recado_url text not null,
  retorno_url text,
  commit_hash text,
  deploy_url text,
  readback_tecnico_em timestamptz,
  validacao_classic_em timestamptz,
  validacao_classic_url text,
  motivo_bloqueio text,
  atualizado_em timestamptz not null default now(),

  constraint engenharia_item_identificacao check (
    item_id ~ '[^[:space:]]' and descricao ~ '[^[:space:]]'
  ),
  constraint engenharia_item_prioridade check (prioridade in ('P0', 'P1', 'P2', 'P3')),
  constraint engenharia_item_fase check (fase_id in ('monitor', 'financeiro', 'prazos', 'materiais', 'handoff')),
  constraint engenharia_item_estado check (estado in (
    'a_fazer', 'enviado_codex', 'em_execucao', 'retorno_recebido',
    'aguardando_validacao_classic', 'concluido', 'bloqueado', 'decisao_negocio_pendente'
  )),
  constraint engenharia_item_recado_url check (
    recado_url ~* '^https://(docs[.]google[.]com|drive[.]google[.]com)/[^[:space:]<>]+$'
  ),
  constraint engenharia_item_retorno_url check (
    retorno_url is null or retorno_url ~* '^https://(docs[.]google[.]com|drive[.]google[.]com)/[^[:space:]<>]+$'
  ),
  constraint engenharia_item_validacao_url check (
    validacao_classic_url is null or validacao_classic_url ~* '^https://(docs[.]google[.]com|drive[.]google[.]com)/[^[:space:]<>]+$'
  ),
  constraint engenharia_item_commit check (commit_hash is null or commit_hash ~ '^[0-9a-fA-F]{40}$'),
  constraint engenharia_item_deploy_url check (
    deploy_url is null or deploy_url ~* '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[0-9]{1,5})?([/?#][^[:space:]<>]*)?$'
  ),
  constraint engenharia_item_motivo check (motivo_bloqueio is null or motivo_bloqueio ~ '[^[:space:]]'),
  constraint engenharia_item_retorno_obrigatorio check (
    estado not in ('retorno_recebido', 'aguardando_validacao_classic', 'concluido')
    or retorno_url is not null
  ),
  constraint engenharia_item_readback_obrigatorio check (
    estado not in ('aguardando_validacao_classic', 'concluido')
    or readback_tecnico_em is not null
  ),
  constraint engenharia_item_validacao_obrigatoria check (
    estado <> 'concluido'
    or (validacao_classic_em is not null and validacao_classic_url is not null)
  ),
  constraint engenharia_item_bloqueio_obrigatorio check (
    estado not in ('bloqueado', 'decisao_negocio_pendente')
    or motivo_bloqueio is not null
  )
);

comment on table public.engenharia_itens is
  'Controle tecnico dos recados ao Codex. O app consulta; a conclusao exige retorno, readback tecnico e evidencia da validacao pelo Classic. Nao representa nem modifica estado de negocio.';
comment on column public.engenharia_itens.atualizado_em is
  'Preenchido na criacao; o escritor autorizado deve atualizar este campo ao registrar mudancas. Sem trigger automatico.';

alter table public.engenharia_itens owner to postgres;
alter table public.engenharia_itens enable row level security;

revoke all on table public.engenharia_itens from public, anon, authenticated, service_role;
grant select on table public.engenharia_itens to authenticated;
grant all on table public.engenharia_itens to service_role;

drop policy if exists engenharia_itens_leitura_autorizada on public.engenharia_itens;
create policy engenharia_itens_leitura_autorizada
  on public.engenharia_itens for select to authenticated
  using ((select public.usuario_autorizado()));

commit;

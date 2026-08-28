-- Inteligência de serviços por amostra técnica — Operação Bahia
-- Aplicada primeiro no staging e depois em produção em 27/08/2026.
-- Aditiva: não apaga/reclassifica dados legados e não faz backfill inferencial.

begin;

create table if not exists public.profissionais (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  apelido text,
  telefone text,
  cidade text,
  ativo boolean not null default true,
  observacao text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint profissionais_nome_nao_vazio check (length(trim(nome)) > 0)
);
create unique index if not exists profissionais_nome_ci_uidx on public.profissionais (lower(trim(nome)));
alter table public.profissionais enable row level security;
drop policy if exists "operador_autorizado" on public.profissionais;
create policy "operador_autorizado" on public.profissionais for all to authenticated
  using ((select usuario_autorizado())) with check ((select usuario_autorizado()));

alter table public.servicos add column if not exists profissional_id uuid references public.profissionais(id) on delete set null;
alter table public.financeiro add column if not exists profissional_id uuid references public.profissionais(id) on delete set null;
create index if not exists servicos_profissional_id_idx on public.servicos(profissional_id);
create index if not exists financeiro_profissional_id_idx on public.financeiro(profissional_id);

create table if not exists public.amostras_tecnicas (
  id uuid primary key default gen_random_uuid(),
  servico_id uuid not null references public.servicos(id),
  profissional_id uuid references public.profissionais(id) on delete set null,
  profissional_texto text,
  tipo_movel text,
  modelo text,
  quantidade integer not null default 1 check (quantidade > 0),
  lugares integer check (lugares is null or lugares > 0),
  modulos integer check (modulos is null or modulos > 0),
  medidas jsonb not null default '{}'::jsonb check (jsonb_typeof(medidas) = 'object'),
  caracteristicas jsonb not null default '{}'::jsonb check (jsonb_typeof(caracteristicas) = 'object'),
  estado text not null default 'PENDENTE_CALIBRACAO_VISUAL'
    check (estado in ('PENDENTE_CALIBRACAO_VISUAL','PARCIAL','COMPLETA')),
  confianca text not null default 'BAIXA' check (confianca in ('BAIXA','MEDIA','ALTA')),
  origem_evidencia text,
  observacao text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists amostras_tecnicas_servico_idx on public.amostras_tecnicas(servico_id);
create index if not exists amostras_tecnicas_profissional_idx on public.amostras_tecnicas(profissional_id);
create index if not exists amostras_tecnicas_estado_idx on public.amostras_tecnicas(estado);
alter table public.amostras_tecnicas enable row level security;
drop policy if exists "operador_autorizado" on public.amostras_tecnicas;
create policy "operador_autorizado" on public.amostras_tecnicas for all to authenticated
  using ((select usuario_autorizado())) with check ((select usuario_autorizado()));

create table if not exists public.amostra_consumos (
  id uuid primary key default gen_random_uuid(),
  amostra_id uuid not null references public.amostras_tecnicas(id),
  categoria text not null check (categoria in ('TECIDO','ESPUMA','OUTRO')),
  parte text,
  material text,
  especificacao text,
  unidade text,
  largura_m numeric check (largura_m is null or largura_m > 0),
  comprimento_m numeric check (comprimento_m is null or comprimento_m > 0),
  espessura_cm numeric check (espessura_cm is null or espessura_cm > 0),
  densidade text,
  qtd_pedida numeric check (qtd_pedida is null or qtd_pedida >= 0),
  qtd_comprada numeric check (qtd_comprada is null or qtd_comprada >= 0),
  qtd_entregue_profissional numeric check (qtd_entregue_profissional is null or qtd_entregue_profissional >= 0),
  qtd_usada numeric check (qtd_usada is null or qtd_usada >= 0),
  qtd_sobra numeric check (qtd_sobra is null or qtd_sobra >= 0),
  custo_previsto numeric check (custo_previsto is null or custo_previsto >= 0),
  custo_real numeric check (custo_real is null or custo_real >= 0),
  fornecedor_id uuid references public.fornecedores(id) on delete set null,
  financeiro_id uuid references public.financeiro(id) on delete set null,
  confianca text not null default 'BAIXA' check (confianca in ('BAIXA','MEDIA','ALTA')),
  origem_evidencia text,
  observacao text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists amostra_consumos_amostra_idx on public.amostra_consumos(amostra_id);
create index if not exists amostra_consumos_categoria_idx on public.amostra_consumos(categoria);
create index if not exists amostra_consumos_financeiro_idx on public.amostra_consumos(financeiro_id);
create index if not exists amostra_consumos_fornecedor_idx on public.amostra_consumos(fornecedor_id);
alter table public.amostra_consumos enable row level security;
drop policy if exists "operador_autorizado" on public.amostra_consumos;
create policy "operador_autorizado" on public.amostra_consumos for all to authenticated
  using ((select usuario_autorizado())) with check ((select usuario_autorizado()));

alter table public.fotos add column if not exists amostra_id uuid references public.amostras_tecnicas(id) on delete set null;
create index if not exists fotos_amostra_id_idx on public.fotos(amostra_id);

create or replace view public.v_servico_aprendizado with (security_invoker = true) as
with fin as (
  select servico_id,
    sum(valor) filter (where tipo='saida' and escopo='empresa' and status='pago') as saidas_pagas_vinculadas,
    sum(valor) filter (where tipo='saida' and escopo='empresa' and status='pago' and categoria='Material') as material_pago,
    sum(valor) filter (where tipo='saida' and escopo='empresa' and status='pago' and categoria ilike 'Mão de obra%') as mao_obra_paga,
    count(*) filter (where tipo='saida' and escopo='empresa' and status='pago' and categoria='Material') as lancamentos_material_pago
  from public.financeiro
  where servico_id is not null
  group by servico_id
), ams as (
  select servico_id, count(*) as amostras_total,
    count(*) filter (where estado='PENDENTE_CALIBRACAO_VISUAL') as amostras_pendentes,
    count(*) filter (where estado='PARCIAL') as amostras_parciais,
    count(*) filter (where estado='COMPLETA') as amostras_completas
  from public.amostras_tecnicas
  group by servico_id
), fts as (
  select servico_id, count(*) as fotos_total,
    count(*) filter (where amostra_id is not null) as fotos_calibradas
  from public.fotos
  where servico_id is not null
  group by servico_id
)
select s.id as servico_id, s.cliente_id, c.nome as cliente_nome, s.titulo, s.status, s.valor_orcamento,
  s.profissional_id,
  coalesce(p.nome, nullif(trim(s.profissional),''), nullif(trim(s.responsavel),'')) as profissional_referencia,
  coalesce(fin.saidas_pagas_vinculadas,0)::numeric as saidas_pagas_vinculadas,
  coalesce(fin.material_pago,0)::numeric as material_pago,
  coalesce(fin.mao_obra_paga,0)::numeric as mao_obra_paga,
  coalesce(fin.lancamentos_material_pago,0)::bigint as lancamentos_material_pago,
  coalesce(ams.amostras_total,0)::bigint as amostras_total,
  coalesce(ams.amostras_pendentes,0)::bigint as amostras_pendentes,
  coalesce(ams.amostras_parciais,0)::bigint as amostras_parciais,
  coalesce(ams.amostras_completas,0)::bigint as amostras_completas,
  coalesce(fts.fotos_total,0)::bigint as fotos_total,
  coalesce(fts.fotos_calibradas,0)::bigint as fotos_calibradas,
  case when coalesce(ams.amostras_total,0)=0 then 'SEM_AMOSTRA'
       when coalesce(ams.amostras_pendentes,0)>0 then 'PENDENTE_CALIBRACAO_VISUAL'
       when coalesce(ams.amostras_parciais,0)>0 then 'PARCIAL'
       else 'COMPLETA' end as estado_aprendizado
from public.servicos s
left join public.clientes c on c.id=s.cliente_id
left join public.profissionais p on p.id=s.profissional_id
left join fin on fin.servico_id=s.id
left join ams on ams.servico_id=s.id
left join fts on fts.servico_id=s.id;

create or replace view public.v_profissionais_pendentes_normalizacao with (security_invoker = true) as
with nomes as (
  select trim(profissional) as nome from public.servicos where nullif(trim(profissional),'') is not null
  union all
  select trim(responsavel) as nome from public.servicos where nullif(trim(responsavel),'') is not null
)
select n.nome, count(*)::bigint as ocorrencias
from nomes n
left join public.profissionais p on lower(trim(p.nome))=lower(n.nome)
where p.id is null
group by n.nome
order by ocorrencias desc, n.nome;

create or replace view public.v_saude_inteligencias with (security_invoker = true) as
select
  (select count(*) from public.servicos where status in ('agendado','producao'))::bigint as servicos_ativos,
  (select count(*) from public.servicos
    where status in ('agendado','producao')
      and (case when jsonb_typeof(coalesce(materiais_necessarios,'[]'::jsonb))='array'
                then jsonb_array_length(coalesce(materiais_necessarios,'[]'::jsonb)) else 0 end)=0)::bigint as servicos_ativos_sem_materiais,
  (select count(*) from public.financeiro
    where tipo='saida' and escopo='empresa' and status='pago' and categoria='Material')::bigint as materiais_pagos_total,
  (select count(*) from public.financeiro
    where tipo='saida' and escopo='empresa' and status='pago' and categoria='Material' and servico_id is null)::bigint as materiais_pagos_sem_servico,
  (select count(*) from public.servicos
    where profissional_id is null and (nullif(trim(profissional),'') is not null or nullif(trim(responsavel),'') is not null))::bigint as servicos_profissional_so_texto,
  (select count(*) from public.profissionais where ativo)::bigint as profissionais_normalizados,
  (select count(*) from public.amostras_tecnicas)::bigint as amostras_total,
  (select count(*) from public.amostras_tecnicas where estado='PENDENTE_CALIBRACAO_VISUAL')::bigint as amostras_pendentes_calibracao,
  (select count(*) from public.amostras_tecnicas where estado='COMPLETA')::bigint as amostras_completas,
  (select count(*) from public.fotos)::bigint as fotos_total,
  (select count(*) from public.fotos where amostra_id is null)::bigint as fotos_sem_amostra;

commit;

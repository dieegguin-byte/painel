-- PROPOSTA DE ORÇAMENTO COMO CARD (Diego, 16/10/2026, 08h46): "botões aprovar com confirmação... se aprovar, a Manu
-- manda pra Zapia, a Zapia manda pro cliente. Se tem algo pra mudar, eu deixo só o recado; a Manu volta com a
-- proposta corrigida e eu aprovo". A rotina de orçamento grava a proposta aqui (status aguardando); o app mostra o
-- card; o toque em Aprovar (confirmado) vale como o "manda" dele para AQUELE texto, que ninguém altera depois.
create table if not exists public.propostas (
  id uuid primary key default gen_random_uuid(),
  servico_id uuid references public.servicos(id) on delete set null,
  cliente_id uuid references public.clientes(id) on delete set null,
  cliente_nome text not null,
  titulo text,                      -- "Sofá 3 lugares — reforma em suede" (o que é a peça/serviço)
  texto_cliente text not null,      -- EXATAMENTE o texto que a Zapia manda ao cliente; o app não edita
  detalhamento text,                -- MO, material em m, espuma em cm por peça, divisor e por quê, frete, arredondamento
  valor_pix numeric(12,2),
  valor_cartao numeric(12,2),
  parcela numeric(12,2),
  versao integer not null default 1,
  substitui_id uuid references public.propostas(id) on delete set null,  -- a versão anterior, quando é correção
  status text not null default 'aguardando' check (status in ('aguardando','aprovada','recado','enviada','cancelada','substituida')),
  recado text,                      -- o que o Diego pediu pra mudar (status recado)
  criado_por text not null default 'orcamento',
  criado_em timestamptz not null default now(),
  decidido_em timestamptz,          -- quando ele tocou Aprovar ou mandou o recado
  enviado_em timestamptz,           -- quando a Manu passou pra Zapia (ela marca)
  resultado text                    -- nota da Manu/orçamento (ex.: "recado na Zapia 12h07")
);
create index if not exists propostas_abertas_idx on public.propostas (criado_em) where status in ('aguardando','aprovada','recado');
create index if not exists propostas_servico_idx on public.propostas (servico_id);
alter table public.propostas enable row level security;
drop policy if exists operador_autorizado on public.propostas;
create policy operador_autorizado on public.propostas for all to authenticated
  using ((select usuario_autorizado())) with check ((select usuario_autorizado()));
revoke all on public.propostas from anon;
grant select, insert, update, delete on public.propostas to authenticated;

select count(*) as propostas_existe from public.propostas;

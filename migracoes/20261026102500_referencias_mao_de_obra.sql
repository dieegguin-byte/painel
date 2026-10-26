-- HISTÓRICO DE PREÇO DE MÃO DE OBRA (pedido da Toqi, 26/10/2026, com o "Sim" do Diego). Só referência pra comparar
-- orçamento: não mexe no caixa, em servicos.valor_mao_de_obra, em vale nem em acerto. Uma instrução por vez, nesta ordem.
-- Revisado pelo Claude antes de aplicar: a primeira versão (commit 22d3f65) vinha numa linha só, procurava o
-- profissional por 'Marlom Junior' sem acento (o cadastro é 'Marlom Júnior', o insert gravaria zero linhas) e tinha
-- ponto e vírgula dentro do texto da observação.
create table if not exists public.referencias_mao_de_obra (id uuid primary key default gen_random_uuid(), profissional_id uuid not null references public.profissionais(id), profissional_nome text not null, tipo_movel text not null, medidas text, quantidade numeric(12,3) check (quantidade is null or quantidade > 0), escopo text not null, material text, valor numeric(12,2) not null check (valor >= 0), unidade_valor text not null check (unidade_valor in ('por_peca','por_metro','por_lote','total')), data_referencia date not null, status text not null default 'pendente' check (status in ('confirmada','ambigua','pendente')), origem_evidencia text, origem_chave text unique, observacao text, criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now());

create index if not exists referencias_mao_de_obra_profissional_data on public.referencias_mao_de_obra (profissional_id, data_referencia desc);

create index if not exists referencias_mao_de_obra_tipo_movel on public.referencias_mao_de_obra (tipo_movel);

create index if not exists referencias_mao_de_obra_status on public.referencias_mao_de_obra (status);

alter table public.referencias_mao_de_obra enable row level security;

drop policy if exists referencias_mao_de_obra_autorizado on public.referencias_mao_de_obra;

create policy referencias_mao_de_obra_autorizado on public.referencias_mao_de_obra for all to authenticated using ((select public.usuario_autorizado())) with check ((select public.usuario_autorizado()));

comment on table public.referencias_mao_de_obra is 'Historico contextual de mao de obra para comparacao de orcamento. Nao altera financeiro, valor_mao_de_obra do servico, acertos ou vales.';

-- Primeira referência: Marlom, 19/10/2026, cabeceiras, 50 reais por peça já montada. O 400/600 dele de 26/10 fica de
-- fora (Diego). Pelo id do cadastro, não pelo nome.
insert into public.referencias_mao_de_obra (profissional_id, profissional_nome, tipo_movel, medidas, escopo, material, valor, unidade_valor, data_referencia, status, origem_evidencia, origem_chave, observacao) select p.id, p.nome, 'Cabeceira', '1,40x2,40 e 1,13x1,20', 'Peça já montada', null, 50.00, 'por_peca', date '2026-10-19', 'confirmada', 'Conversa com profissional', 'whatsapp-marlom-2026-10-19-r50-peca-montada', 'Preço por peça já montada. Comparação aproximada, não usar como preço fechado para peça, acabamento ou medidas diferentes.' from public.profissionais p where p.id = 'da780e73-c71d-444c-ae59-52f19993d191' on conflict (origem_chave) do nothing;

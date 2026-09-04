-- INTELIGÊNCIA DE COMPRAS / COMPROVANTES — recado do Classic de 01/09/2026.
--
-- O DEFEITO: o comprovante virava um lançamento agregado em `financeiro` e mais nada. O papel da Ellis
-- trazia 6 itens com preço unitário; o banco guardou "R$ 415,00, Ellis Tecidos". Preço de espuma, tecido
-- e acessório — que é o que decide orçamento e margem — evaporava na hora de lançar.
--
-- AUDITORIA ANTES DE CRIAR (o recado exige, e estava certo em exigir): não existe estrutura reaproveitável.
-- `financeiro` é valor agregado, `estoque_movimentos` é saldo físico e `amostra_consumos` é consumo REAL de
-- um serviço — nenhum dos três guarda documento de compra com item e preço unitário. São 2 tabelas novas,
-- aditivas: nada existente é alterado, e nenhum lançamento financeiro é tocado (item 9 do recado).
--
-- A DECISÃO DE DESENHO QUE IMPORTA — versão, não soma. O pedido 81865 chegou em DUAS fotos com o mesmo
-- número, a mesma data e o mesmo horário (28/08 11:12), e conteúdos diferentes: R$ 395,00 e R$ 429,00.
-- Somar daria R$ 824 de material que nunca foi comprado. Por isso o snapshot é uma LINHA de documento com
-- `revisao` e `status_reconciliacao`, agrupada por `documento_chave`. Enquanto ninguém provar qual é a
-- versão final, as duas ficam em 'conflito' — e conflito NÃO entra na view de histórico, nem em soma
-- nenhuma. O índice único abaixo garante isso no banco, não na boa vontade de quem escreve.
--
-- E o par documento × pagamento fica SEPARADO: a Ellis imprimiu R$ 417,95 e o Pix foi R$ 415,00. Os R$ 2,95
-- não viram "desconto" por dedução — `total_documento` e `valor_pago` são campos distintos justamente para
-- a diferença ficar visível em vez de ser explicada por chute.

create table if not exists public.compras_documentos (
  id uuid primary key default gen_random_uuid(),
  -- Identidade estável do pedido, para agrupar snapshots do MESMO documento. Quem escreve define
  -- (ex.: "afibracom-81865"). Nulo = documento avulso, sem irmãos.
  documento_chave text,
  fornecedor_id uuid references public.fornecedores(id),
  -- O nome como veio no papel, quando ainda não dá pra apontar o fornecedor cadastrado. No 81865 o
  -- fornecedor nem aparece na foto: `fornecedor_raw` fica nulo e o documento segue existindo.
  fornecedor_raw text,
  numero_documento text,
  tipo_documento text not null default 'desconhecido'
    check (tipo_documento in ('pre_venda','pedido','nota','cupom','orcamento','desconhecido')),
  emitido_em date,
  total_documento numeric(12,2),
  desconto numeric(12,2),
  valor_pago numeric(12,2),
  pago_em date,
  forma_pagamento text,
  -- Vínculos OPCIONAIS. `servico_id` só quando comprovado pelo documento — o recado é explícito: não
  -- ligar o R$ 500 da Afibracom ao pedido 81865 só porque as datas são próximas.
  financeiro_id uuid references public.financeiro(id),
  servico_id uuid references public.servicos(id),
  revisao integer not null default 1 check (revisao >= 1),
  status_reconciliacao text not null default 'unica'
    check (status_reconciliacao in ('unica','final','conflito','superada')),
  origem_evidencia text,
  observacao text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- A TRAVA CENTRAL: no máximo UMA versão válida por documento. Tentar marcar os dois snapshots do 81865
-- como 'final' dá erro de constraint em vez de dobrar o custo do material em silêncio.
create unique index if not exists compras_documentos_uma_versao_valida
  on public.compras_documentos (documento_chave)
  where documento_chave is not null and status_reconciliacao in ('unica','final');

create index if not exists compras_documentos_fornecedor on public.compras_documentos (fornecedor_id);
create index if not exists compras_documentos_servico on public.compras_documentos (servico_id);
create index if not exists compras_documentos_emissao on public.compras_documentos (emitido_em desc);

create table if not exists public.compras_itens (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.compras_documentos(id) on delete cascade,
  codigo_externo text,
  -- SEMPRE o texto do papel, sem limpeza. É a evidência; se a normalização errar, ele continua aqui.
  descricao_original text not null,
  -- Só preencher quando for SEGURO. "PX1200 Soft 3 cm" e "PX1000 3cm" são densidades diferentes e casá-las
  -- inventa histórico de preço — o mesmo erro que já cometi no casamento do estoque com a lista de compras.
  material_normalizado text,
  quantidade numeric(12,3),
  unidade text,
  preco_unitario numeric(12,4),
  -- O total impresso na linha, como está no papel. Não é derivado: documento tem arredondamento próprio
  -- (a Ellis imprime 0,500 × 53,80 = 26,90) e a diferença é informação, não erro a corrigir.
  total_linha numeric(12,2),
  servico_id uuid references public.servicos(id),
  confianca text not null default 'media' check (confianca in ('alta','media','baixa')),
  criado_em timestamptz not null default now()
);

create index if not exists compras_itens_documento on public.compras_itens (documento_id);
create index if not exists compras_itens_material on public.compras_itens (material_normalizado);

alter table public.compras_documentos enable row level security;
alter table public.compras_itens enable row level security;

-- Mesmo padrão de estoque/amostras: quem opera é o Diego autorizado, e `usuario_autorizado()` já é a
-- função canônica do projeto. Logado não é o mesmo que autorizado — ver 2026-08-27_rls_logado_nao_e_autorizado.
drop policy if exists compras_documentos_autorizado on public.compras_documentos;
create policy compras_documentos_autorizado on public.compras_documentos
  for all using ((select public.usuario_autorizado())) with check ((select public.usuario_autorizado()));

drop policy if exists compras_itens_autorizado on public.compras_itens;
create policy compras_itens_autorizado on public.compras_itens
  for all using ((select public.usuario_autorizado())) with check ((select public.usuario_autorizado()));

-- HISTÓRICO COMPARÁVEL (itens 7 e 8 do recado). Compara o mesmo item, na mesma unidade, do mesmo
-- fornecedor — e traz a variação em R$ e %. `compras_do_item` existe para o consumidor saber quando NÃO
-- generalizar: 1 compra não é histórico, é uma compra. Quem lê deve dizer "sem histórico comparável"
-- em vez de fingir tendência com dois pontos.
create or replace view public.v_compras_historico_item
with (security_invoker = true) as
with base as (
  select
    i.id as item_id, d.id as documento_id,
    coalesce(f.nome, d.fornecedor_raw) as fornecedor,
    d.fornecedor_id, d.numero_documento, d.emitido_em,
    i.descricao_original, i.unidade, i.quantidade, i.preco_unitario, i.total_linha,
    coalesce(i.material_normalizado, lower(i.descricao_original)) as chave_item,
    coalesce(d.fornecedor_id::text, lower(coalesce(d.fornecedor_raw, ''))) as chave_fornecedor
  from public.compras_itens i
  join public.compras_documentos d on d.id = i.documento_id
  left join public.fornecedores f on f.id = d.fornecedor_id
  -- SNAPSHOT EM CONFLITO NÃO ENTRA. É o ponto do desenho: enquanto ninguém provar a versão final do
  -- 81865, ele não contamina preço histórico nenhum.
  where d.status_reconciliacao in ('unica','final')
)
select
  b.*,
  lag(b.preco_unitario) over w as preco_unitario_anterior,
  b.preco_unitario - lag(b.preco_unitario) over w as variacao_reais,
  case when lag(b.preco_unitario) over w > 0
    then round(((b.preco_unitario - lag(b.preco_unitario) over w) / lag(b.preco_unitario) over w) * 100, 2)
  end as variacao_pct,
  count(*) over (partition by b.chave_item, b.unidade, b.chave_fornecedor) as compras_do_item
from base b
window w as (partition by b.chave_item, b.unidade, b.chave_fornecedor order by b.emitido_em, b.documento_id);

comment on table public.compras_documentos is
  'Documento de compra (pre-venda, pedido, nota). Snapshots do mesmo pedido sao REVISOES agrupadas por documento_chave, nunca compras somadas: ver o caso 81865 de 28/08/2026. total_documento e valor_pago sao campos separados de proposito (Ellis: 417,95 impresso, 415,00 pago).';
comment on table public.compras_itens is
  'Itens do documento de compra, com preco unitario. descricao_original e sempre o texto do papel; material_normalizado so quando o casamento for seguro.';
comment on view public.v_compras_historico_item is
  'Historico de preco por item+unidade+fornecedor, com variacao em R$ e %. Documento em conflito fica de fora. compras_do_item diz quando NAO ha base pra generalizar.';

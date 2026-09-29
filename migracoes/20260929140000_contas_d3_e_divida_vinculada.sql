-- CONTAS A PAGAR: AVISO D-3 COM NOME E DÍVIDA LIGADA ÀS PARCELAS — 29/09/2026
--
-- Atende dois recados do Classic: "FINANCEIRO VISÍVEL E AVISO D-3" (26/09) e "separar compra financiada de
-- saída de caixa" (28/09).
--
-- 1. financeiro.divida_id — a parcela a_pagar que quita uma dívida aponta para ela.
--    Caso real: compra da Ellis (pré-venda 00100930) paga nos cartões da Raquel. A dívida de R$ 1.746 em
--    `dividas` e as parcelas de R$ 771 e R$ 975 em `financeiro` eram o MESMO dinheiro sem ligação nenhuma.
--    O app mostrava as duas coisas ao mesmo tempo, e pagar uma parcela não baixava a dívida.
--
-- 2. Gatilho financeiro_baixa_divida — quando a parcela ligada vira "pago", o valor entra em
--    dividas.valor_pago (e sai de volta se ela voltar para a_pagar ou for apagada). A baixa da obrigação
--    acontece no mesmo movimento que tira o dinheiro do caixa, e a parcela paga continua na categoria da
--    dívida, então não vira uma segunda despesa de material. Dívida que zera o saldo passa a "quitada".
--    ⚠ Com divida_id preenchido, NÃO somar o pagamento em dividas.valor_pago à mão: contaria duas vezes.
--
-- 3. push_pendencias devolve a LISTA das contas que vencem até D+3 (e as vencidas), não só a contagem.
--    O resumo passa a ignorar Vale e Mão de obra, igual ao app (resumoContas): as 8 linhas antigas de mão de
--    obra "[ACERTADO]" ainda em a_pagar inflavam o "N conta(s) a pagar" do push das 07:30.

alter table public.financeiro add column if not exists divida_id uuid references public.dividas(id) on delete set null;
create index if not exists financeiro_divida_id_idx on public.financeiro (divida_id) where divida_id is not null;

create or replace function public.financeiro_baixa_divida()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  saiu numeric := 0;   -- o que a linha ANTIGA contava como pago na dívida dela
  entrou numeric := 0; -- o que a linha NOVA conta como pago na dívida dela
  alvo uuid;
  delta numeric;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.divida_id is not null and old.status = 'pago' and old.tipo = 'saida' then
    saiu := coalesce(old.valor, 0);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.divida_id is not null and new.status = 'pago' and new.tipo = 'saida' then
    entrou := coalesce(new.valor, 0);
  end if;

  -- Mesma dívida antes e depois: aplica só a diferença. Trocou de dívida: tira de uma e põe na outra.
  for alvo, delta in
    select x.id, sum(x.v) from (
      select case when tg_op in ('UPDATE', 'DELETE') then old.divida_id end as id, -saiu as v
      union all
      select case when tg_op in ('INSERT', 'UPDATE') then new.divida_id end, entrou
    ) x
    where x.id is not null
    group by x.id
    having sum(x.v) <> 0
  loop
    update dividas d
       set valor_pago = coalesce(d.valor_pago, 0) + delta,
           status = case when coalesce(d.valor_pago, 0) + delta >= d.valor_original then 'quitada' else 'aberta' end,
           atualizado_em = now()
     where d.id = alvo;
  end loop;
  return null;
end;
$$;

drop trigger if exists financeiro_baixa_divida on public.financeiro;
create trigger financeiro_baixa_divida
  after insert or update of status, valor, divida_id, tipo or delete on public.financeiro
  for each row execute function public.financeiro_baixa_divida();

create or replace function public.push_pendencias()
 returns jsonb
 language sql
 security definer
 set search_path to 'public'
as $function$
with agora as (select (now() at time zone 'America/Sao_Paulo') as t),
     hoje  as (select (now() at time zone 'America/Sao_Paulo')::date as d),
     -- Mesmo recorte da aba "A pagar" e do alerta do Painel (resumoContas): Vale e Mão de obra vivem na aba
     -- Profissionais, onde um desconta o outro, e não são conta com vencimento.
     contas as (
       select f.id, f.descricao, f.categoria, f.escopo, f.valor, f.data, (f.data - hoje.d) as dias
       from financeiro f, hoje
       where f.status = 'a_pagar' and f.tipo = 'saida' and f.data is not null
         and coalesce(f.categoria, '') not in ('Vale', 'Mão de obra')
         and f.data <= hoje.d + 3
     )
select jsonb_build_object(
  'agora', (select t from agora),
  'hoje',  (select d from hoje),
  -- Proximas 6h, em ordem. `na_janela` marca quem ja esta dentro da hora que dispara o aviso.
  'agenda', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'titulo', coalesce(nullif(btrim(pe.titulo), ''), a.titulo), 'hora', to_char(a.hora,'HH24:MI'),
      'local', a.local, 'cidade', a.cidade, 'tipo', a.tipo, 'servico_id', a.servico_id,
      'faltam', floor(extract(epoch from ((a.data + a.hora) - agora.t))/60)::int,
      'na_janela', ((a.data + a.hora) <= agora.t + interval '60 minutes')
    ) order by (a.data + a.hora))
    from agenda a
    left join pessoais pe on pe.id = a.pessoal_id, agora
    where a.status = 'planejado' and a.hora is not null
      and (a.data + a.hora) >= agora.t
      and (a.data + a.hora) <= agora.t + interval '6 hours'
  ), '[]'::jsonb),
  'caixa', coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'texto', left(c.texto, 160)))
    from caixa_entrada c
    where c.processado = false and c.criado_em > now() - interval '24 hours'
  ), '[]'::jsonb),
  -- Vencidas e as que vencem até D+3, uma por linha. A descrição vai inteira porque o push-enviar aplica a
  -- mesma regra de "sem vencimento" do app (SEM_VENCIMENTO), que lê a frase toda.
  'contas', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'descricao', c.descricao, 'categoria', c.categoria, 'escopo', c.escopo,
      'valor', c.valor, 'data', c.data, 'dias', c.dias
    ) order by c.data, c.valor desc)
    from contas c
  ), '[]'::jsonb),
  'resumo', (select jsonb_build_object(
    'compromissos_hoje',  (select count(*) from agenda a,     hoje where a.status='planejado' and a.data = hoje.d and a.hora is not null),
    'proximo_hoje',       (select to_char(min(a.hora),'HH24:MI') from agenda a, hoje where a.status='planejado' and a.data = hoje.d and a.hora is not null),
    'retornos_vencidos',  (select count(*) from servicos s,    hoje where s.status in ('lead','orcamento') and s.prazo is not null and s.prazo < hoje.d),
    'contas_vencendo',    (select count(*) from contas),
    'contas_valor',       (select coalesce(sum(valor),0)::numeric(12,2) from contas),
    'caixa_pendente',     (select count(*) from caixa_entrada where processado = false)
  ))
);
$function$;

-- Conferência
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'financeiro' and column_name = 'divida_id') as coluna_divida_id,
  (select count(*) from pg_trigger where tgname = 'financeiro_baixa_divida' and not tgisinternal) as gatilho,
  jsonb_array_length(public.push_pendencias() -> 'contas') as contas_ate_d3;

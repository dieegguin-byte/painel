-- BOTÕES NA NOTIFICAÇÃO (Diego, 13/10/2026: "algumas coisas resolver por lá sem entrar no app, o WhatsApp
-- mesmo responde rapidamente por lá" — mostrando o Niagara com o WA Business).
--
-- O que muda: o cartão pra você (duvidas_agente, status aberta) passa a chegar como notificação no celular,
-- com até 2 botões (as duas primeiras `opcoes`). Tocar no botão grava a resposta SEM abrir o app, pelo mesmo
-- caminho que o recibo de entrega já usa: o service worker chama push-enviar?modo=acao com o uuid do recibo
-- (que só existe dentro da carga cifrada) e a letra do botão. O plano do que cada botão faz fica gravado AQUI,
-- no recibo, na hora do envio — o aparelho só devolve "a0" ou "a1", nunca o texto. Assim ninguém grava
-- resposta inventada: só uma das opções que a própria pergunta ofereceu.
--
-- Aplicada em 13/10/2026 pelo Claude Projetos (Supabase MCP, execute_sql em partes: apply_migration estourava
-- 60 s) depois do sim do Diego. Idempotente.

-- 1. O recibo guarda o plano dos botões e carimba quando um foi tocado.
alter table public.push_recibos add column if not exists acoes jsonb;
alter table public.push_recibos add column if not exists acionado_em timestamptz;
alter table public.push_recibos add column if not exists acao text;
comment on column public.push_recibos.acoes is 'Plano por botao: {"a0": {"tabela":"duvidas_agente","id":"...","resposta":"Feito"}, "a1": {...}}. Nulo quando o aviso nao tem botao.';

-- 2. Abrir recibo passa a aceitar o plano. É uma SEGUNDA assinatura, sem default e sem apagar a de um
-- argumento: a Edge Function nova sempre manda p_acoes (nulo quando não há botão), e a versão antiga da
-- função, se ainda rodar, continua caindo na de um argumento. Com default, o PostgREST não saberia qual
-- escolher quando só p_tag vier. (O drop da antiga travou no Supabase MCP em 13/10; ficou as duas.)
create or replace function public.push_recibo_abrir(p_tag text, p_acoes jsonb) returns uuid
language sql security definer set search_path = public as $$
  insert into push_recibos (tag, acoes) values (p_tag, p_acoes) returning recibo;
$$;
revoke execute on function public.push_recibo_abrir(text, jsonb) from public, anon, authenticated;
grant  execute on function public.push_recibo_abrir(text, jsonb) to service_role;

-- 3. O toque no botão. Só faz o que o plano gravado no recibo diz; um recibo só aceita UM toque.
create or replace function public.push_acao(p_recibo uuid, p_acao text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.push_recibos%rowtype;
  plano jsonb;
  linha record;
begin
  select * into r from push_recibos where recibo = p_recibo for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'recibo desconhecido'); end if;
  if r.acionado_em is not null then return jsonb_build_object('ok', true, 'motivo', 'ja respondido', 'resposta', r.acao); end if;
  plano := r.acoes -> p_acao;
  if plano is null then return jsonb_build_object('ok', false, 'motivo', 'botao sem plano'); end if;

  if plano ->> 'tabela' = 'duvidas_agente' then
    update duvidas_agente
       set status = 'respondida', resposta = plano ->> 'resposta', respondido_em = now()
     where id = (plano ->> 'id')::uuid and status = 'aberta'
     returning id, pergunta, cliente_id into linha;
    if not found then
      -- Já foi respondido pelo app (ou descartado) antes do toque: não sobrescreve o que ele decidiu lá.
      update push_recibos set acionado_em = now(), acao = p_acao where recibo = p_recibo;
      return jsonb_build_object('ok', true, 'motivo', 'cartao ja fechado no app');
    end if;
    insert into historico (o_que, por, detalhe)
    values ('Respondeu ao Claude pela notificação: ' || left(linha.pergunta, 80), 'diego',
            (plano ->> 'resposta') || coalesce(' · cliente ' || linha.cliente_id::text, ''));
  elsif plano ->> 'tabela' = 'teste' then
    -- modo=teste da Edge Function: só prova que o toque chegou até aqui.
    null;
  else
    return jsonb_build_object('ok', false, 'motivo', 'tabela sem tratamento');
  end if;

  update push_recibos set acionado_em = now(), acao = p_acao where recibo = p_recibo;
  return jsonb_build_object('ok', true, 'resposta', plano ->> 'resposta');
end;
$$;
revoke execute on function public.push_acao(uuid, text) from public, anon, authenticated;
grant  execute on function public.push_acao(uuid, text) to service_role;

-- 4. push_pendencias devolve os cartões abertos (últimas 24h). O resto da função é igual à versão de 29/09.
create or replace function public.push_pendencias() returns jsonb
language sql security definer set search_path = public as $$
with agora as (select (now() at time zone 'America/Sao_Paulo') as t),
     hoje  as (select (now() at time zone 'America/Sao_Paulo')::date as d),
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
  -- CARTÕES PRA VOCÊ: pergunta aberta das últimas 24h. As opções vão junto pra virar botão; o nome do
  -- cliente vai pro texto do aviso. Quem perguntou (origem) vira o título: "Manu pergunta", "Auditoria pergunta".
  'duvidas', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'pergunta', left(d.pergunta, 200), 'contexto', left(d.contexto, 120), 'opcoes', d.opcoes,
      'origem', d.origem, 'cliente', c.nome, 'criado_em', d.criado_em
    ) order by d.criado_em)
    from duvidas_agente d left join clientes c on c.id = d.cliente_id
    where d.status = 'aberta' and d.criado_em > now() - interval '24 hours'
  ), '[]'::jsonb),
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
$$;
revoke execute on function public.push_pendencias() from public, anon, authenticated;
grant  execute on function public.push_pendencias() to service_role;

-- Conferência
select
  (select count(*) from information_schema.columns where table_name = 'push_recibos' and column_name in ('acoes','acionado_em','acao')) as colunas_novas,
  (select count(*) from pg_proc where proname = 'push_acao') as push_acao,
  jsonb_array_length(public.push_pendencias() -> 'duvidas') as cartoes_abertos_24h;

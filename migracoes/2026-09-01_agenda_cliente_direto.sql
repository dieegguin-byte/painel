-- AGENDA -> CLIENTE SEM PASSAR PELO SERVICO (item COMPROMISSOS-WHATSAPP-JACKSON-20260830-001).
--
-- O app resolvia o cliente de um compromisso por UM caminho so:
--     agenda.servico_id -> servicos.cliente_id -> clientes.telefone
-- Compromisso de cliente legitimo que ainda nao tem servico caia fora dele: sem nome no cartao, sem
-- telefone, sem botao de WhatsApp e sem ficha. O Jackson revelou a lacuna -- o servico dele NAO foi criado
-- de proposito, porque o que foi combinado estava num audio que ninguem transcreveu, e criar servico falso
-- pra fazer um botao nascer seria mentir no banco pra consertar tela.
--
-- Coluna NULA por padrao e sem trava nova: quando existe servico_id, ele continua tendo precedencia.
-- Este vinculo e para quem ainda nao tem servico, e so com identidade confirmada -- NUNCA por semelhanca de
-- nome no titulo do compromisso.
--
-- Rollback:
--   drop index if exists public.agenda_cliente_id_idx;
--   alter table public.agenda drop column if exists cliente_id;
-- (o app le `a.cliente_id` de forma defensiva: sem a coluna o campo vem undefined e o comportamento volta
--  a ser exatamente o de antes, sem quebrar nenhuma tela.)

alter table public.agenda
  add column if not exists cliente_id uuid references public.clientes(id) on delete set null;

comment on column public.agenda.cliente_id is
  'Vinculo direto Agenda->Cliente para compromisso de cliente que ainda nao tem servico. Preencher SO com identidade confirmada; nunca por inferencia de nome no titulo. Quando existe servico_id, ele tem precedencia.';

create index if not exists agenda_cliente_id_idx on public.agenda (cliente_id) where cliente_id is not null;

-- BACKFILL PEDIDO NO RECADO -- unico registro, com o cliente_id ja confirmado pelo Classic.
-- (Em 01/09 este compromisso ja estava com status 'cancelado'; o vinculo entra do mesmo jeito, porque e
--  identidade, nao estado operacional.)
update public.agenda
   set cliente_id = '1a1746e9-802d-4c55-8b00-a61d21b68e33'
 where id = '427b0bfc-fd1b-48cf-9c7d-896233d89738'
   and cliente_id is null;


-- COMPROMISSO PESSOAL LEGIVEL TAMBEM NA NOTIFICACAO (item APP-AGENDA-TITULO-PESSOAL-20260829-01).
--
-- push_pendencias() mandava `a.titulo` cru, entao o push do compromisso pessoal chegava no celular escrito
-- "Compromisso pessoal" -- exatamente o texto generico que o item manda parar de mostrar. O titulo de
-- verdade mora em public.pessoais.titulo, ligado por agenda.pessoal_id.
--
-- Nada mais muda: mesma janela de 6h, mesmos campos, mesma ordem. Sem vinculo pessoal (ou com titulo
-- vazio), continua saindo o titulo da propria agenda.
create or replace function public.push_pendencias()
 returns jsonb
 language sql
 security definer
 set search_path to 'public'
as $function$
with agora as (select (now() at time zone 'America/Sao_Paulo') as t),
     hoje  as (select (now() at time zone 'America/Sao_Paulo')::date as d)
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
  'resumo', (select jsonb_build_object(
    'compromissos_hoje',  (select count(*) from agenda a,     hoje where a.status='planejado' and a.data = hoje.d and a.hora is not null),
    'proximo_hoje',       (select to_char(min(a.hora),'HH24:MI') from agenda a, hoje where a.status='planejado' and a.data = hoje.d and a.hora is not null),
    'retornos_vencidos',  (select count(*) from servicos s,    hoje where s.status in ('lead','orcamento') and s.prazo is not null and s.prazo < hoje.d),
    'contas_vencendo',    (select count(*) from financeiro f,  hoje where f.status='a_pagar' and f.data <= hoje.d + 3),
    'contas_valor',       (select coalesce(sum(f.valor),0)::numeric(12,2) from financeiro f, hoje where f.status='a_pagar' and f.data <= hoje.d + 3),
    'caixa_pendente',     (select count(*) from caixa_entrada where processado = false)
  ))
);
$function$;

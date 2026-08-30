-- NOTIFICAÇÃO NO CELULAR — 29/08/2026
-- Item 003 da fila. Não é regressão: o app NUNCA teve uma linha de Notification, pushManager ou VAPID.
-- Estava embutido na ideia de "app instalado", e nunca foi construído.
--
-- O QUE O DIEGO ESCOLHEU NOTIFICAR (os quatro): compromisso da agenda, retorno vencido, novidade na
-- caixa de entrada e conta vencendo.
--
-- POR QUE NÃO É UMA NOTIFICAÇÃO POR ITEM. Medido no banco em 29/08, antes de escrever qualquer código:
--   retorno vencido ....... 63 serviços
--   caixa não processada .. 41 itens (mas só 2 chegaram nas últimas 24h)
--   conta a pagar vencida . 12 lançamentos, R$ 3.204,30
--   compromisso com hora .. 2 hoje, média de 2,5/dia nos últimos 60 dias
-- Notificar "estado" mandaria 116 notificações no primeiro disparo e o Diego desligaria a permissão no
-- mesmo minuto — e permissão negada no Android não se pede de novo, tem que ir no ajuste do sistema.
-- Então a regra é: só vira notificação individual o que é NOVO e tem hora marcada. Backlog vira um
-- número dentro de um resumo único de manhã.
--
--   agenda ......... individual, 1h antes da hora. Sem hora não notifica: pela regra do próprio app
--                    (ehCobranca) remoto sem hora é cobrança, não deslocamento — vai pro resumo.
--   caixa .......... individual, só o que chegou nas últimas 24h. Latência de até 5 min.
--   retorno vencido  agregado, uma linha do resumo das 7h30.
--   conta vencendo . agregado, mesma linha do resumo.
--
-- FUSO: agenda.data e agenda.hora são locais (Brasília) e não têm timezone. O servidor roda em UTC, e
-- por isso TODA conta de "hoje" aqui passa por America/Sao_Paulo. Medido durante esta migração: às
-- 22h55 de Brasília, current_date já era o dia seguinte no servidor — usar current_date cru teria feito
-- o resumo da manhã contar o dia errado e o lembrete chegar 3h depois do compromisso.

-- =========================================================================== 1. TABELAS

-- ASSINATURAS. Uma linha por aparelho. O endpoint é a identidade (o Android troca de endpoint quando
-- reinstala o app, e aí nasce outra linha; a velha morre com 410 e é desativada sozinha).
create table if not exists public.push_assinaturas (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  aparelho text,
  criado_em timestamptz not null default now(),
  ultimo_ok timestamptz,
  ultimo_erro text,
  falhas int not null default 0,
  ativo boolean not null default true
);

-- MESMA TRAVA DO RESTO DO BANCO: estar logado não basta, tem que estar em usuarios_autorizados.
alter table public.push_assinaturas enable row level security;
drop policy if exists operador_autorizado on public.push_assinaturas;
create policy operador_autorizado on public.push_assinaturas for all to authenticated
  using ((select usuario_autorizado())) with check ((select usuario_autorizado()));

-- DEDUPLICAÇÃO. A varredura roda a cada 5 minutos; sem isto o mesmo compromisso das 14h viraria 12
-- notificações entre 13h e 14h. A chave carrega o id real do item, então é estável entre execuções.
create table if not exists public.push_enviados (
  chave text primary key,
  enviado_em timestamptz not null default now()
);
alter table public.push_enviados enable row level security;
-- Sem policy de propósito: só o service_role (a Edge Function) mexe aqui. O app não tem o que ler.

create index if not exists push_enviados_data on public.push_enviados (enviado_em);
create index if not exists push_assinaturas_ativas on public.push_assinaturas (ativo) where ativo;

comment on table public.push_assinaturas is 'Aparelhos inscritos para notificacao push (Web Push/VAPID). Escrita pelo app; leitura pela Edge Function push-enviar.';
comment on table public.push_enviados is 'Trava de repeticao do push. Uma linha por notificacao ja entregue; a varredura de 5 min consulta antes de mandar.';

-- =========================================================================== 2. FUNÇÕES

-- Ponte pro vault. O PostgREST não expõe o schema vault, então a Edge Function lê por aqui.
create or replace function public.push_segredo(nome text) returns text
language sql security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = nome limit 1;
$$;

-- Grava só se ainda não existir. A chave VAPID nasce uma vez e nunca troca: trocar invalida todas as
-- assinaturas já feitas nos aparelhos.
create or replace function public.push_segredo_criar(nome text, valor text, nota text default null)
returns boolean language plpgsql security definer set search_path = public, vault as $$
begin
  if exists (select 1 from vault.secrets where name = nome) then return false; end if;
  perform vault.create_secret(valor, nome, nota);
  return true;
end;
$$;

-- Reserva atômica: devolve só as chaves que AINDA NÃO tinham sido enviadas. Reservar antes de mandar
-- evita duplicata quando duas varreduras se cruzam; se o envio falhar, a Edge Function solta a chave.
create or replace function public.push_reservar(chaves text[]) returns text[]
language sql security definer set search_path = public as $$
  with ins as (
    insert into push_enviados (chave)
    select unnest(chaves) on conflict (chave) do nothing
    returning chave
  ) select coalesce(array_agg(chave), '{}'::text[]) from ins;
$$;

create or replace function public.push_soltar(chaves text[]) returns void
language sql security definer set search_path = public as $$
  delete from push_enviados where chave = any(chaves);
$$;

-- O COLETOR DOS QUATRO GATILHOS, numa consulta só.
create or replace function public.push_pendencias() returns jsonb
language sql security definer set search_path = public as $$
with agora as (select (now() at time zone 'America/Sao_Paulo') as t),
     hoje  as (select (now() at time zone 'America/Sao_Paulo')::date as d)
select jsonb_build_object(
  'agora', (select t from agora),
  'hoje',  (select d from hoje),
  -- INDIVIDUAL: compromisso com hora entrando na próxima hora. Sem hora não entra: pela regra do
  -- próprio app (ehCobranca) remoto sem hora é cobrança, não deslocamento.
  'agenda', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'titulo', a.titulo, 'hora', to_char(a.hora,'HH24:MI'),
      'local', a.local, 'cidade', a.cidade, 'tipo', a.tipo, 'servico_id', a.servico_id,
      'faltam', floor(extract(epoch from ((a.data + a.hora) - agora.t))/60)::int))
    from agenda a, agora
    where a.status = 'planejado' and a.hora is not null
      and (a.data + a.hora) >= agora.t
      and (a.data + a.hora) <= agora.t + interval '60 minutes'
  ), '[]'::jsonb),
  -- INDIVIDUAL: só o que chegou nas últimas 24h. O backlog de 41 itens foi semeado como já-enviado.
  'caixa', coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'texto', left(c.texto, 160)))
    from caixa_entrada c
    where c.processado = false and c.criado_em > now() - interval '24 hours'
  ), '[]'::jsonb),
  -- AGREGADO: vira uma linha do resumo da manhã. 63 retornos vencidos não podem virar 63 notificações.
  'resumo', (select jsonb_build_object(
    'compromissos_hoje',  (select count(*) from agenda a,     hoje where a.status='planejado' and a.data = hoje.d and a.hora is not null),
    'proximo_hoje',       (select to_char(min(a.hora),'HH24:MI') from agenda a, hoje where a.status='planejado' and a.data = hoje.d and a.hora is not null),
    'retornos_vencidos',  (select count(*) from servicos s,    hoje where s.status in ('lead','orcamento') and s.prazo is not null and s.prazo < hoje.d),
    'contas_vencendo',    (select count(*) from financeiro f,  hoje where f.status='a_pagar' and f.data <= hoje.d + 3),
    'contas_valor',       (select coalesce(sum(f.valor),0)::numeric(12,2) from financeiro f, hoje where f.status='a_pagar' and f.data <= hoje.d + 3),
    'caixa_pendente',     (select count(*) from caixa_entrada where processado = false)
  ))
);
$$;

-- Só a Edge Function (service_role) chama isto. O app não tem o que fazer aqui.
revoke execute on function public.push_segredo(text)                 from public, anon, authenticated;
revoke execute on function public.push_segredo_criar(text,text,text) from public, anon, authenticated;
revoke execute on function public.push_reservar(text[])              from public, anon, authenticated;
revoke execute on function public.push_soltar(text[])                from public, anon, authenticated;
revoke execute on function public.push_pendencias()                  from public, anon, authenticated;
grant  execute on function public.push_segredo(text)                 to service_role;
grant  execute on function public.push_segredo_criar(text,text,text) to service_role;
grant  execute on function public.push_reservar(text[])              to service_role;
grant  execute on function public.push_soltar(text[])                to service_role;
grant  execute on function public.push_pendencias()                  to service_role;

-- =========================================================================== 3. SEGREDOS
-- Rodados uma vez. A chave VAPID NÃO está aqui: ela é gerada pela própria Edge Function na primeira
-- chamada de ?modo=chave e gravada no vault direto — nunca passa por arquivo nem pelo repositório.
--
--   select public.push_segredo_criar('PUSH_SECRET', encode(extensions.gen_random_bytes(32),'hex'), '...');
--   select public.push_segredo_criar('PUSH_URL', 'https://iymlzdcloaeyybhefywp.supabase.co/functions/v1/push-enviar', '...');

-- =========================================================================== 4. AGENDAMENTO

-- Um lugar só pra chamar a Edge Function. O pg_cron chama isto, e dá pra disparar na mão pra testar
-- sem a senha precisar sair do vault.
create or replace function public.push_disparar(modo text) returns bigint
language sql security definer set search_path = public, net, extensions as $$
  select net.http_post(
    url := public.push_segredo('PUSH_URL'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', public.push_segredo('PUSH_SECRET')
    ),
    body := jsonb_build_object('modo', modo),
    timeout_milliseconds := 25000
  );
$$;
revoke execute on function public.push_disparar(text) from public, anon, authenticated;

create extension if not exists pg_cron;

-- ATENÇÃO AO FUSO: o pg_cron deste projeto roda em GMT (conferido: cron.timezone = GMT). Por isso o
-- resumo das 7h30 da manhã do Diego está agendado às 10:30 UTC. Se um dia o horário de verão voltar,
-- este número muda — o Brasil não tem horário de verão desde 2019, então hoje é fixo.
--   select cron.schedule('push-varredura', '*/5 * * * *',  $x$select public.push_disparar('varredura')$x$);
--   select cron.schedule('push-resumo',    '30 10 * * *',  $x$select public.push_disparar('resumo')$x$);

-- =========================================================================== 5. SEMEADURA
-- Rodada uma vez, na virada: marca o backlog da caixa como "já notificado" pra que a primeira varredura
-- não dispare 41 notificações de uma vez.
--   insert into push_enviados (chave)
--   select 'caixa:' || id from caixa_entrada where processado = false
--   on conflict (chave) do nothing;

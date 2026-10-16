-- CARD DE PAGAR LIGADO AO DINHEIRO, NOS DOIS SENTIDOS (Diego, 16/10/2026, 15h57: "marquei que eu paguei a Fibracom,
-- só que o card dele não subiu... se eu marcar que eu paguei, tem que sumir lá de dinheiro... e vice-versa").
-- A ligação é EXPLÍCITA e mora no card: agenda.financeiro_id = o lançamento a pagar/a receber que aquele card paga.
-- NÃO usa financeiro.agenda_id: essa coluna já pendura material numa viagem (Compras → "Aproveitar viagem", pedido
-- remoto, material em mãos) e ali Feito/Paguei NÃO podem mexer um no outro (revisão de 16/10: entrega concluída
-- pagaria material não comprado, pedido sem pagar viraria pago, comprar material fecharia a entrega).
--   * lançamento vira pago (Paguei/Recebi no Dinheiro, Manu, auditoria) → o card ligado vira feito (data vira hoje se era futura)
--   * card ligado vira feito (Feito no app, Manu)                      → o lançamento vira pago, com a data de hoje
--   * Desfazer de qualquer lado devolve o outro como estava — só o que ESTE gatilho mudou (marca em jsonb).
-- Lançamento com valor 0 ("VALOR A CONFIRMAR") NUNCA vira pago pelo card: sem valor não há o que baixar.
--
-- PROPOSTA APROVADA FECHA O CARD DO ORÇAMENTO (Diego, 16/10/2026, 15h58: aprovou a proposta do João e o card ficou).
-- Aprovar fecha o card planejado "Mandar orçamento / Aprovar a proposta — <cliente>" do mesmo serviço (ou
-- propostas.agenda_id, se quem gravou a proposta já ligou). Sem serviço, só fecha se houver UM card assim do cliente.
-- Desfazer (aprovada → aguardando) reabre o card.

alter table public.agenda add column if not exists financeiro_id uuid references public.financeiro(id) on delete set null;
alter table public.agenda add column if not exists fechado_por jsonb;            -- {origem: financeiro|proposta, id, data, em}: quem fechou o card e a data de antes
alter table public.financeiro add column if not exists baixa_pela_agenda jsonb;  -- {status, data, agenda_id, em}: como estava antes do Feito do card
alter table public.propostas add column if not exists agenda_id uuid references public.agenda(id) on delete set null;
create index if not exists agenda_financeiro_idx on public.agenda (financeiro_id) where financeiro_id is not null;

-- 1) Dinheiro → card. BEFORE: limpa a marca de "baixado pelo card" quando o status muda por outro caminho, pra um
-- Desfazer do card nunca devolver um pagamento de verdade.
create or replace function private.trg_financeiro_fecha_card() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if pg_trigger_depth() > 1 or new.status is not distinct from old.status then return new; end if;
  new.baixa_pela_agenda := null;
  if old.status = 'pago' and new.status in ('a_pagar', 'a_receber') then
    update agenda a
       set status = 'planejado', data = coalesce((a.fechado_por->>'data')::date, a.data), fechado_por = null
     where a.financeiro_id = new.id and a.status = 'feito'
       and ((a.fechado_por->>'origem' = 'financeiro' and a.fechado_por->>'id' = new.id::text)
         or a.id::text = old.baixa_pela_agenda->>'agenda_id');  -- o card que pagou este lançamento
  elsif new.status = 'pago' and old.status in ('a_pagar', 'a_receber') then
    update agenda a
       set status = 'feito', data = least(a.data, hoje),
           fechado_por = jsonb_build_object('origem', 'financeiro', 'id', new.id, 'data', a.data, 'em', now())
     where a.financeiro_id = new.id and a.status = 'planejado';
  end if;
  return new;
end $$;
drop trigger if exists financeiro_fecha_card on public.financeiro;
create trigger financeiro_fecha_card before update of status on public.financeiro
  for each row execute function private.trg_financeiro_fecha_card();

-- 2) Card → Dinheiro
create or replace function private.trg_agenda_baixa_financeiro() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if pg_trigger_depth() > 1 or new.financeiro_id is null then return null; end if;
  if old.status = 'planejado' and new.status = 'feito' then
    update financeiro f
       set status = 'pago', data = hoje,
           baixa_pela_agenda = jsonb_build_object('status', f.status, 'data', f.data, 'agenda_id', new.id, 'em', now())
     where f.id = new.financeiro_id and f.status in ('a_pagar', 'a_receber') and coalesce(f.valor, 0) > 0;
  elsif old.status = 'feito' and new.status = 'planejado' then
    update financeiro f
       set status = f.baixa_pela_agenda->>'status', data = (f.baixa_pela_agenda->>'data')::date, baixa_pela_agenda = null
     where f.id = new.financeiro_id and f.status = 'pago' and f.baixa_pela_agenda->>'agenda_id' = new.id::text;
  end if;
  return null;
end $$;
drop trigger if exists agenda_baixa_financeiro on public.agenda;
create trigger agenda_baixa_financeiro after update of status on public.agenda
  for each row execute function private.trg_agenda_baixa_financeiro();

-- 3) Proposta aprovada → card do orçamento
create or replace function private.trg_propostas_fecha_card() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  card uuid;
  achados int;
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if new.status = 'aprovada' and old.status is distinct from 'aprovada' then
    card := new.agenda_id;
    if card is null and new.servico_id is not null then
      select a.id into card from agenda a
       where a.status = 'planejado' and a.servico_id = new.servico_id
         and a.titulo ~* '^\s*(mandar|enviar|aprovar)\s+(o\s+|a\s+)?(orçamento|orcamento|proposta)'
       order by a.data, a.hora
       limit 1;
    elsif card is null and new.cliente_id is not null then
      select count(*), min(a.id::text)::uuid into achados, card from agenda a
       where a.status = 'planejado' and a.cliente_id = new.cliente_id
         and a.titulo ~* '^\s*(mandar|enviar|aprovar)\s+(o\s+|a\s+)?(orçamento|orcamento|proposta)';
      if achados <> 1 then card := null; end if;
    end if;
    if card is not null then
      update agenda a
         set status = 'feito', data = least(a.data, hoje),
             fechado_por = jsonb_build_object('origem', 'proposta', 'id', new.id, 'data', a.data, 'em', now())
       where a.id = card and a.status = 'planejado';
      if found then new.agenda_id := card; end if;
    end if;
  elsif old.status = 'aprovada' and new.status = 'aguardando' then
    update agenda a
       set status = 'planejado', data = coalesce((a.fechado_por->>'data')::date, a.data), fechado_por = null
     where a.status = 'feito' and a.fechado_por->>'origem' = 'proposta' and a.fechado_por->>'id' = new.id::text;
  end if;
  return new;
end $$;
drop trigger if exists propostas_fecha_card on public.propostas;
create trigger propostas_fecha_card before update of status on public.propostas
  for each row execute function private.trg_propostas_fecha_card();

revoke all on function private.trg_financeiro_fecha_card() from public;
revoke all on function private.trg_agenda_baixa_financeiro() from public;
revoke all on function private.trg_propostas_fecha_card() from public;

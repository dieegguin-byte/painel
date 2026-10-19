-- "JÁ MANDEI" NA PROPOSTA (Diego, 19/10/2026: ele manda o orçamento pelo WhatsApp dele e procurou no app onde marcar).
-- O app grava a proposta direto como 'enviada' (aguardando → enviada). O gatilho só fechava o card "Mandar orçamento"
-- no 'aprovada'; agora fecha também quando a proposta vira 'enviada' sem ter passado por 'aprovada', e o Desfazer
-- (enviada → aguardando) reabre o card como o Desfazer do Aprovar. aprovada → enviada (a Manu passando pra Zapia)
-- continua sem mexer no card, que já foi fechado no Aprovar.
create or replace function private.trg_propostas_fecha_card()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  card uuid;
  achados int;
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if new.status in ('aprovada', 'enviada') and old.status not in ('aprovada', 'enviada') then
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
  elsif old.status in ('aprovada', 'enviada') and new.status = 'aguardando' then
    update agenda a
       set status = 'planejado', data = coalesce((a.fechado_por->>'data')::date, a.data), fechado_por = null
     where a.status = 'feito' and a.fechado_por->>'origem' = 'proposta' and a.fechado_por->>'id' = new.id::text;
  end if;
  return new;
end $function$

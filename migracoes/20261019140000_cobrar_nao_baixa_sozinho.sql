-- COBREI NÃO É RECEBI (Diego, 19/10/2026: "Cobrei não quer dizer que recebi. Recebido tem que estar no financeiro, ou no
-- dinheiro ou no cartão. Não tem como ter um recebido sem passar pelo financeiro"). O Feito do card "Cobrar Wedson"
-- (17/10) deu o a receber de R$ 350 como pago, sem conta e sem forma, por este gatilho. Agora ele só baixa conta a
-- PAGAR (o app já pergunta "Pagou?" antes). A receber só vira pago pelo app (pergunta "Recebeu?", quanto e por onde
-- entrou) ou por quem lança o recebimento no financeiro. O caminho de volta (Desfazer do card) fica igual.
create or replace function private.trg_agenda_baixa_financeiro()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if pg_trigger_depth() > 1 or new.financeiro_id is null then return null; end if;
  if old.status = 'planejado' and new.status = 'feito' then
    update financeiro f
       set status = 'pago', data = hoje,
           baixa_pela_agenda = jsonb_build_object('status', f.status, 'data', f.data, 'agenda_id', new.id, 'em', now())
     where f.id = new.financeiro_id and f.status = 'a_pagar' and coalesce(f.valor, 0) > 0;
  elsif old.status = 'feito' and new.status = 'planejado' then
    update financeiro f
       set status = f.baixa_pela_agenda->>'status', data = (f.baixa_pela_agenda->>'data')::date, baixa_pela_agenda = null
     where f.id = new.financeiro_id and f.status = 'pago' and f.baixa_pela_agenda->>'agenda_id' = new.id::text;
  end if;
  return null;
end $function$;

-- Confere: o gatilho não fala mais em a_receber na baixa.
select position('a_receber' in pg_get_functiondef('private.trg_agenda_baixa_financeiro()'::regprocedure)) = 0 as aplicada;

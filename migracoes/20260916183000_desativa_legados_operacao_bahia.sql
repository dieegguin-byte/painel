-- Operação Bahia: fechamento estrutural dos caminhos legados em 16-09-2026.
-- Esta migration espelha a mudança já aplicada no Supabase de produção. Preserva histórico e bloqueia novas entradas legadas.

create or replace function public.bahia_bloqueia_google_event_id()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.google_event_id is not null then
      raise exception using errcode='55000', message='Operação Bahia: google_event_id é legado; Google Calendar está desativado. Use public.agenda sem sincronização externa.';
    end if;
    return new;
  end if;
  if new.google_event_id is distinct from old.google_event_id then
    raise exception using errcode='55000', message='Operação Bahia: google_event_id é legado e não pode ser criado/alterado. Google Calendar está desativado.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bahia_bloqueia_google_event_id_insert on public.agenda;
create trigger trg_bahia_bloqueia_google_event_id_insert before insert on public.agenda for each row execute function public.bahia_bloqueia_google_event_id();
drop trigger if exists trg_bahia_bloqueia_google_event_id_update on public.agenda;
create trigger trg_bahia_bloqueia_google_event_id_update before update of google_event_id on public.agenda for each row execute function public.bahia_bloqueia_google_event_id();
comment on column public.agenda.google_event_id is 'LEGADO HISTÓRICO — Google Calendar está desativado na Operação Bahia. IDs existentes são preservados; novas atribuições/alterações são bloqueadas por trigger.';

create or replace function private.bahia_legado_bloqueia_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode='55000', message=format('Operação Bahia: %I.%I é legado/desativado para novas entradas; preserve o histórico e use a arquitetura canônica vigente.',tg_table_schema,tg_table_name);
end;
$$;

alter table public.github_change_requests disable trigger trg_gcr_dispara_executor;
drop trigger if exists trg_gcr_bloqueia_novos on public.github_change_requests;
create trigger trg_gcr_bloqueia_novos before insert on public.github_change_requests for each row execute function private.bahia_legado_bloqueia_insert();
revoke insert, update, delete, truncate on table public.github_change_requests from anon, authenticated;
comment on table public.github_change_requests is 'LEGADO/DESATIVADO em 16-09-2026. Histórico da antiga ponte Classic -> GitHub. Não recebe novos pedidos; engenharia atual segue Claude/Engenharia e handoff técnico no Drive.';
comment on function public.gcr_dispara_executor() is 'LEGADO/DESATIVADO em 16-09-2026. Trigger de disparo da antiga ponte Classic -> GitHub está desabilitado.';

drop trigger if exists trg_engenharia_itens_bloqueia_novos on public.engenharia_itens;
create trigger trg_engenharia_itens_bloqueia_novos before insert on public.engenharia_itens for each row execute function private.bahia_legado_bloqueia_insert();
comment on table public.engenharia_itens is 'LEGADO/DESATIVADO para novas entradas em 16-09-2026. Preserva histórico dos recados Codex de 15-09-2026; não é canal técnico vigente. Claude/Engenharia é o executor técnico padrão; Codex somente por pedido explícito de Diego.';

drop trigger if exists trg_operacao_comandos_bloqueia_novos on private.operacao_comandos;
create trigger trg_operacao_comandos_bloqueia_novos before insert on private.operacao_comandos for each row execute function private.bahia_legado_bloqueia_insert();
drop trigger if exists trg_operacao_outbox_bloqueia_novos on private.operacao_outbox;
create trigger trg_operacao_outbox_bloqueia_novos before insert on private.operacao_outbox for each row execute function private.bahia_legado_bloqueia_insert();
revoke execute on function private.claim_operacao_comando(text,text,text,text,jsonb,text,text,text,text,text,timestamptz,jsonb,timestamptz,uuid,text,text,text) from service_role;
comment on table private.operacao_comandos is 'LEGADO/DESATIVADO para novas entradas em 16-09-2026. Histórico do antigo Command Journal; não governa a Operação Bahia atual.';
comment on table private.operacao_outbox is 'LEGADO/DESATIVADO para novas entradas em 16-09-2026. Histórico da antiga outbox/Calendar; não governa a Operação Bahia atual.';
comment on function private.claim_operacao_comando(text,text,text,text,jsonb,text,text,text,text,text,timestamptz,jsonb,timestamptz,uuid,text,text,text) is 'LEGADO/DESATIVADO em 16-09-2026. Execução por service_role revogada; usar o CRUD canônico + readback + Gate.';

-- Executar somente apos validar o schema e o leitor do app.
-- Nao toca nos jobs existentes push-varredura/push-resumo.
begin;

do $guard$
declare
  v_existente record;
begin
  if current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'O agendamento deve pertencer ao usuario postgres.';
  end if;
  if pg_catalog.to_regprocedure('private.conferencia_executar()') is null then
    raise exception using errcode = '55000', message = 'Instale e valide primeiro o schema do monitor.';
  end if;
  select jobid, command, username into v_existente
    from cron.job where jobname = 'bahia-conferencia-pronto-v1';
  if found and (v_existente.command <> 'set statement_timeout = ''10s''; select private.conferencia_executar();' or v_existente.username <> 'postgres') then
    raise exception using errcode = '55000', message = 'O nome reservado do monitor ja pertence a outro agendamento.';
  end if;
end;
$guard$;

-- Repetir a ativacao substitui somente este mesmo job, sem criar duplicatas.
-- O timeout precisa ser definido ANTES da chamada direta feita pelo cron.
select cron.schedule(
  'bahia-conferencia-pronto-v1',
  '*/5 * * * *',
  'set statement_timeout = ''10s''; select private.conferencia_executar();'
);

-- Torna a reativacao explicita mesmo quando o job existente estava pausado.
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'bahia-conferencia-pronto-v1' and username = 'postgres'),
  active := true
);

commit;

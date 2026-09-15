-- Rollback operacional: pausa exclusivamente o monitor novo e preserva seus dados tecnicos.
-- Nao altera os outros jobs, o schema private, servicos, agenda ou financeiro.
begin;

do $pause$
declare
  v_job record;
begin
  select jobid, command, username into v_job
    from cron.job where jobname = 'bahia-conferencia-pronto-v1';
  if not found then
    return;
  end if;
  if v_job.command <> 'set statement_timeout = ''10s''; select private.conferencia_executar();' or v_job.username <> 'postgres' then
    raise exception using errcode = '55000', message = 'O nome reservado do monitor pertence a outro agendamento; nada foi pausado.';
  end if;
  perform cron.alter_job(job_id := v_job.jobid, active := false);
end;
$pause$;

commit;

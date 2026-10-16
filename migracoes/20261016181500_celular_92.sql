-- CELULAR QUE COMEÇA COM 92..95 (16/10/2026, lead Isa +55 61 92002-4804 recusado): a regra '9[6-9][0-9]{7}' só
-- aceitava celular começando com 96..99. Celular no Brasil é 9 + 8 dígitos, então vale '9[0-9]{8}'.
-- Aplicado no banco em 16/10 por execute_sql, um comando por vez.
create or replace function private.whatsapp_phone_ok(p_telefone text) returns boolean language sql immutable
  set search_path to 'pg_catalog' as $function$
  select p_telefone is not null and regexp_replace(p_telefone, '\D', '', 'g') ~ '^55[1-9][0-9]9[0-9]{8}$';
$function$;

alter table public.clientes drop constraint clientes_telefone_celular_br,
  add constraint clientes_telefone_celular_br check (telefone is null or regexp_replace(telefone, '\D', '', 'g') ~ '^55[1-9][0-9]9[0-9]{8}$');
alter table public.fornecedores drop constraint fornecedores_telefone_celular_br,
  add constraint fornecedores_telefone_celular_br check (telefone is null or regexp_replace(telefone, '\D', '', 'g') ~ '^55[1-9][0-9]9[0-9]{8}$');

-- agenda_criar_da_caixa tinha a mesma regra escrita duas vezes: troca só o padrão, mantém o resto da função.
do $do$
declare d text;
begin
  select pg_get_functiondef('public.agenda_criar_da_caixa(uuid,text,uuid,uuid,text,date,time without time zone,text,text)'::regprocedure) into d;
  if position('9[6-9][0-9]{7}' in d) > 0 then execute replace(d, '9[6-9][0-9]{7}', '9[0-9]{8}'); end if;
end $do$;

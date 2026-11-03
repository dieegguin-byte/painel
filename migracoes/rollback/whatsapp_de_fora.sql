-- Reversão do WhatsApp de fora (20261103190000_whatsapp_de_fora.sql). Antes de rodar, troque ou limpe o telefone de
-- quem tem número de fora (select id, nome, telefone from clientes where btrim(telefone) like '+%' and
-- regexp_replace(telefone, '\D', '', 'g') !~ '^55'), senão a trava velha recusa a volta.
create or replace function private.whatsapp_phone_ok(p_telefone text) returns boolean language sql immutable set search_path to 'pg_catalog' as $f$ select p_telefone is not null and regexp_replace(p_telefone, '\D', '', 'g') ~ '^55[1-9][0-9]9[0-9]{8}$' $f$;
alter table public.clientes drop constraint if exists clientes_telefone_whatsapp, add constraint clientes_telefone_celular_br check (telefone is null or regexp_replace(telefone, '\D', '', 'g') ~ '^55[1-9][0-9]9[0-9]{8}$');
select private.whatsapp_phone_ok('+1 555 010 0199') as de_fora_volta_a_ser_recusado;

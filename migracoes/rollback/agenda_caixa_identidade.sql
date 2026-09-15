-- Reversão de comportamento. Preserva caixa_entrada_id e seus valores para auditoria.
-- A coluna/índice podem permanecer sem efeito na criação antiga; não apagar vínculos.
DROP FUNCTION IF EXISTS public.agenda_criar_da_caixa(uuid,text,uuid,uuid,text,date,time,text,text);
CREATE OR REPLACE FUNCTION private.trg_agenda_servico_exige_whatsapp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE v_tel text;
BEGIN
  IF new.status = 'planejado' AND new.servico_id IS NOT NULL THEN
    SELECT c.telefone INTO v_tel FROM public.servicos s
      JOIN public.clientes c ON c.id = s.cliente_id WHERE s.id = new.servico_id;
    IF NOT private.whatsapp_phone_ok(v_tel) THEN
      RAISE EXCEPTION 'Agenda de cliente exige serviço com WhatsApp válido';
    END IF;
  END IF;
  RETURN new;
END;
$function$;
DROP TRIGGER agenda_servico_exige_whatsapp ON public.agenda;
CREATE TRIGGER agenda_servico_exige_whatsapp
  BEFORE INSERT OR UPDATE OF servico_id,status ON public.agenda
  FOR EACH ROW EXECUTE FUNCTION private.trg_agenda_servico_exige_whatsapp();

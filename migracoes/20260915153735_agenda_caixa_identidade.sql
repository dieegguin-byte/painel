-- Caixa -> Agenda: identidade explícita e idempotência pela origem, sem casamento por texto.
-- Não atualiza registros existentes nem reativa compromissos cancelados.
ALTER TABLE public.agenda ADD COLUMN IF NOT EXISTS caixa_entrada_id uuid
  REFERENCES public.caixa_entrada(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS agenda_caixa_entrada_unica ON public.agenda(caixa_entrada_id)
  WHERE caixa_entrada_id IS NOT NULL;
-- Reaplicação após o rollback conservador só aceita exatamente o contrato esperado.
DO $check$
DECLARE v_col smallint;
BEGIN
  SELECT attnum INTO v_col FROM pg_attribute
    WHERE attrelid='public.agenda'::regclass AND attname='caixa_entrada_id'
      AND atttypid='uuid'::regtype AND NOT attnotnull AND NOT attisdropped;
  IF v_col IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid='public.agenda'::regclass
      AND contype='f' AND conkey=ARRAY[v_col] AND confrelid='public.caixa_entrada'::regclass
      AND confdeltype='n' AND confkey=ARRAY[(SELECT attnum FROM pg_attribute
        WHERE attrelid='public.caixa_entrada'::regclass AND attname='id')]
  ) THEN RAISE EXCEPTION 'Coluna de origem da Caixa tem contrato incompatível'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index WHERE indexrelid='public.agenda_caixa_entrada_unica'::regclass
      AND indrelid='public.agenda'::regclass AND indisunique AND indnkeyatts=1
      AND indkey[0]=v_col AND pg_get_expr(indpred,indrelid)='(caixa_entrada_id IS NOT NULL)'
  ) THEN RAISE EXCEPTION 'Índice de origem da Caixa tem contrato incompatível'; END IF;
END;
$check$;
COMMENT ON COLUMN public.agenda.caixa_entrada_id IS
  'Origem da criação pela Caixa. Não é identidade de cliente; sem preenchimento retroativo.';

CREATE OR REPLACE FUNCTION private.trg_agenda_servico_exige_whatsapp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE v_cliente uuid; v_tel text;
BEGIN
  IF new.status <> 'planejado' THEN RETURN new; END IF;
  IF new.servico_id IS NOT NULL THEN
    SELECT s.cliente_id INTO v_cliente FROM public.servicos s WHERE s.id = new.servico_id;
    IF v_cliente IS NULL THEN
      RAISE EXCEPTION 'Agenda de cliente exige serviço com cliente vinculado';
    END IF;
    IF new.cliente_id IS NOT NULL AND new.cliente_id <> v_cliente THEN
      RAISE EXCEPTION 'Cliente da agenda não corresponde ao cliente do serviço';
    END IF;
    -- Identidade vem exclusivamente da FK do serviço, nunca do nome/título/telefone.
    new.cliente_id := v_cliente;
  END IF;
  IF new.cliente_id IS NOT NULL THEN
    SELECT c.telefone INTO v_tel FROM public.clientes c WHERE c.id = new.cliente_id;
    IF NOT private.whatsapp_phone_ok(v_tel) THEN
      RAISE EXCEPTION 'Agenda de cliente exige cliente com WhatsApp válido';
    END IF;
  END IF;
  RETURN new;
END;
$function$;
DROP TRIGGER agenda_servico_exige_whatsapp ON public.agenda;
CREATE TRIGGER agenda_servico_exige_whatsapp
  BEFORE INSERT OR UPDATE OF servico_id, cliente_id, status ON public.agenda
  FOR EACH ROW EXECUTE FUNCTION private.trg_agenda_servico_exige_whatsapp();

CREATE OR REPLACE FUNCTION public.agenda_criar_da_caixa(
  p_caixa_id uuid, p_natureza text, p_cliente_id uuid, p_servico_id uuid,
  p_titulo text, p_data date, p_hora time, p_tipo text, p_cidade text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_caixa public.caixa_entrada%ROWTYPE;
  v_agenda public.agenda%ROWTYPE;
  v_cliente uuid := p_cliente_id;
  v_cliente_servico uuid;
  v_tel text;
  v_bloqueado boolean;
  v_confirmacao jsonb;
  v_evento jsonb;
  v_tel_confirmado text;
BEGIN
  IF NOT coalesce(public.usuario_autorizado(), false) THEN
    RAISE EXCEPTION 'Operador não autorizado' USING ERRCODE = '42501';
  END IF;
  -- Serializa somente esta origem; o índice único também protege chamadas concorrentes.
  SELECT * INTO v_caixa FROM public.caixa_entrada WHERE id = p_caixa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entrada da Caixa não encontrada ou sem acesso'; END IF;
  IF p_natureza IS NULL OR p_natureza NOT IN ('cliente','avulso','pessoal','operacional') THEN
    RAISE EXCEPTION 'Escolha se o compromisso é de cliente, avulso, pessoal ou operacional';
  END IF;
  -- Estado explícito, em ordem de conversa. A resolução preserva o histórico do bloqueio.
  v_bloqueado := coalesce(v_caixa.texto, '') ~* 'BLOQUEIO DE CADASTRO';
  FOR v_evento IN SELECT value FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(v_caixa.conversa) = 'array' THEN v_caixa.conversa ELSE '[]'::jsonb END
  ) WITH ORDINALITY ORDER BY ordinality LOOP
    IF coalesce(v_evento->>'texto', '') ~* 'BLOQUEIO DE CADASTRO'
       OR v_evento#>>'{meta,tipo_operacional}' = 'cadastro_bloqueado' THEN
      v_bloqueado := true; v_confirmacao := NULL;
    END IF;
    IF v_evento#>>'{meta,tipo_operacional}' = 'cadastro_validado' THEN
      v_tel_confirmado := regexp_replace(coalesce(v_evento#>>'{meta,telefone_confirmado}', ''), '\D', '', 'g');
      IF length(v_tel_confirmado) = 11 THEN v_tel_confirmado := '55' || v_tel_confirmado; END IF;
      IF nullif(v_evento#>>'{meta,cliente_id}', '') IS NOT NULL
         AND v_tel_confirmado ~ '^55[1-9][0-9]9[6-9][0-9]{7}$' THEN
        v_confirmacao := v_evento->'meta'; v_bloqueado := false;
      END IF;
    END IF;
  END LOOP;
  IF v_bloqueado THEN
    RAISE EXCEPTION 'Cadastro bloqueado: confirme a identidade e resolva o bloqueio na Caixa antes de agendar';
  END IF;
  IF p_natureza = 'cliente' THEN
    IF p_servico_id IS NOT NULL THEN
      SELECT cliente_id INTO v_cliente_servico FROM public.servicos WHERE id = p_servico_id;
      IF v_cliente_servico IS NULL THEN RAISE EXCEPTION 'Serviço não encontrado ou sem cliente'; END IF;
      IF v_cliente IS NOT NULL AND v_cliente <> v_cliente_servico THEN
        RAISE EXCEPTION 'Cliente não corresponde ao serviço escolhido';
      END IF;
      v_cliente := v_cliente_servico;
    END IF;
    IF v_cliente IS NULL THEN
      RAISE EXCEPTION 'Escolha um cliente cadastrado; sem identidade segura a entrada permanece na Caixa';
    END IF;
    SELECT telefone INTO v_tel FROM public.clientes WHERE id = v_cliente;
    -- Mesma regra oficial de private.whatsapp_phone_ok; não concede acesso ao schema privado.
    IF v_tel IS NULL OR regexp_replace(v_tel, '\D', '', 'g') !~ '^55[1-9][0-9]9[6-9][0-9]{7}$' THEN
      RAISE EXCEPTION 'Cliente sem WhatsApp válido: confirme o número e mantenha a pendência na Caixa';
    END IF;
  ELSIF p_cliente_id IS NOT NULL OR p_servico_id IS NOT NULL THEN
    RAISE EXCEPTION 'Compromisso vinculado a cliente deve ser classificado como cliente';
  END IF;
  IF v_confirmacao IS NOT NULL THEN
    v_tel_confirmado := regexp_replace(v_confirmacao->>'telefone_confirmado', '\D', '', 'g');
    IF length(v_tel_confirmado) = 11 THEN v_tel_confirmado := '55' || v_tel_confirmado; END IF;
    IF p_natureza <> 'cliente' OR v_cliente::text IS DISTINCT FROM lower(v_confirmacao->>'cliente_id')
       OR regexp_replace(v_tel, '\D', '', 'g') IS DISTINCT FROM v_tel_confirmado THEN
      RAISE EXCEPTION 'Confirmação de cadastro não corresponde ao cliente e WhatsApp escolhidos';
    END IF;
  END IF;
  SELECT * INTO v_agenda FROM public.agenda WHERE caixa_entrada_id = p_caixa_id;
  IF FOUND THEN
    IF v_agenda.status <> 'planejado' THEN
      RAISE EXCEPTION 'Esta entrada já gerou compromisso encerrado ou cancelado; ele não será reativado';
    END IF;
    IF v_agenda.cliente_id IS DISTINCT FROM v_cliente
       OR v_agenda.servico_id IS DISTINCT FROM p_servico_id
       OR v_agenda.titulo IS DISTINCT FROM btrim(p_titulo)
       OR v_agenda.data IS DISTINCT FROM p_data
       OR v_agenda.hora IS DISTINCT FROM p_hora
       OR v_agenda.tipo IS DISTINCT FROM p_tipo
       OR v_agenda.cidade IS DISTINCT FROM nullif(btrim(p_cidade), '') THEN
      RAISE EXCEPTION 'Esta entrada já tem outro compromisso; revise o vínculo existente';
    END IF;
    RETURN to_jsonb(v_agenda);
  END IF;
  IF coalesce(v_caixa.processado, false) OR v_caixa.status = 'resolvido' THEN
    RAISE EXCEPTION 'Entrada já resolvida; nenhum compromisso foi criado';
  END IF;
  IF nullif(btrim(p_titulo), '') IS NULL OR p_data IS NULL OR p_hora IS NULL
     OR p_tipo IS NULL OR p_tipo NOT IN ('presencial','remoto','pessoal','operacional') THEN
    RAISE EXCEPTION 'Informe título, data, horário e tipo do compromisso';
  END IF;
  INSERT INTO public.agenda(titulo,data,hora,tipo,cidade,status,cliente_id,servico_id,caixa_entrada_id)
  VALUES(btrim(p_titulo),p_data,p_hora,p_tipo,nullif(btrim(p_cidade),''),'planejado',v_cliente,p_servico_id,p_caixa_id)
  RETURNING * INTO v_agenda;
  -- Readback da linha após todas as travas, dentro da mesma transação.
  SELECT * INTO STRICT v_agenda FROM public.agenda WHERE id = v_agenda.id;
  RETURN to_jsonb(v_agenda);
END;
$function$;
REVOKE ALL ON FUNCTION public.agenda_criar_da_caixa(uuid,text,uuid,uuid,text,date,time,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_criar_da_caixa(uuid,text,uuid,uuid,text,date,time,text,text) TO authenticated;

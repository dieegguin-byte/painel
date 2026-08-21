-- Operacao Bahia V4 - baseline estrutural capturada da producao
-- Captura: 2026-08-21
-- IMPORTANTE: reproduz o estado atual para testar o caminho V3 -> V4.
-- Policies legadas permissivas sao preservadas nesta baseline de proposito.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS vault;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

CREATE TABLE public.agenda (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  servico_id uuid,
  titulo text NOT NULL,
  data date NOT NULL,
  hora time without time zone,
  local text,
  status text DEFAULT 'planejado'::text,
  google_event_id text,
  criado_em timestamp with time zone DEFAULT now() NOT NULL,
  cidade text,
  tipo text DEFAULT 'presencial'::text NOT NULL
);

CREATE TABLE public.caixa_entrada (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  texto text NOT NULL,
  criado_em timestamp with time zone DEFAULT now() NOT NULL,
  processado boolean DEFAULT false NOT NULL,
  processado_em timestamp with time zone,
  status text DEFAULT 'novo'::text NOT NULL,
  conversa jsonb DEFAULT '[]'::jsonb NOT NULL
);

CREATE TABLE public.clientes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  nome text,
  telefone text,
  cidade text,
  endereco text,
  obs text,
  criado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.config (
  id integer DEFAULT 1 NOT NULL,
  pin_hash text,
  ajustes jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE public.dividas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  credor text NOT NULL,
  fornecedor_id uuid,
  cliente_id uuid,
  valor_original numeric NOT NULL,
  valor_pago numeric DEFAULT 0 NOT NULL,
  descricao text,
  status text DEFAULT 'aberta'::text NOT NULL,
  criado_em timestamp with time zone DEFAULT now() NOT NULL,
  atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.estoque (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  item text NOT NULL,
  quantidade numeric(10,2) DEFAULT 0,
  unidade text,
  minimo numeric(10,2) DEFAULT 0,
  comprar boolean DEFAULT false,
  obs text,
  atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.financeiro (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tipo text NOT NULL,
  escopo text NOT NULL,
  categoria text,
  valor numeric(10,2) NOT NULL,
  descricao text,
  status text DEFAULT 'pago'::text,
  data date DEFAULT CURRENT_DATE NOT NULL,
  criado_em timestamp with time zone DEFAULT now() NOT NULL,
  fornecedor_id uuid,
  servico_id uuid,
  agenda_id uuid
);

CREATE TABLE public.fornecedores (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  nome text NOT NULL,
  contato_nome text,
  telefone text,
  produtos text,
  dias_entrega text,
  observacao text,
  criado_em timestamp with time zone DEFAULT now(),
  cidade text
);

CREATE TABLE public.fotos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  servico_id uuid,
  cliente_id uuid,
  url text NOT NULL,
  tipo text,
  criado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.github_change_requests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  idempotency_key text NOT NULL,
  repository text DEFAULT 'dieegguin-byte/painel'::text NOT NULL,
  base_branch text DEFAULT 'main'::text NOT NULL,
  arquivos jsonb NOT NULL,
  commit_message text NOT NULL,
  motivo text NOT NULL,
  solicitado_por text DEFAULT 'classic'::text NOT NULL,
  status text DEFAULT 'pendente'::text NOT NULL,
  branch text,
  commit_sha text,
  pr_number integer,
  pr_url text,
  erro text,
  tentativas integer DEFAULT 0 NOT NULL,
  criado_em timestamp with time zone DEFAULT now() NOT NULL,
  atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
  processado_em timestamp with time zone
);

CREATE TABLE public.guia_ia (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  secao text NOT NULL,
  titulo text NOT NULL,
  conteudo text NOT NULL,
  atualizado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.historico (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  o_que text NOT NULL,
  quando timestamp with time zone DEFAULT now() NOT NULL,
  por text,
  detalhe text
);

CREATE TABLE public.marketing_atribuicoes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tracking_ref text NOT NULL,
  gclid text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  campaign_id text,
  ad_group_id text,
  ad_id text,
  keyword text,
  match_type text,
  device text,
  landing_page text,
  referrer text,
  criado_em timestamp with time zone DEFAULT now() NOT NULL,
  gbraid text,
  wbraid text
);

CREATE TABLE public.rotinas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  titulo text NOT NULL,
  intervalo_dias integer NOT NULL,
  hora text,
  observacao text,
  ultima_execucao date,
  ativo boolean DEFAULT true NOT NULL,
  criado_em timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.servicos (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  cliente_id uuid,
  titulo text NOT NULL,
  descricao text,
  status text DEFAULT 'lead'::text NOT NULL,
  prioridade text DEFAULT 'media'::text,
  valor_orcamento numeric(10,2),
  profissional text,
  prazo date,
  proxima_acao text,
  sugestao_resposta text,
  origem text,
  criado_em timestamp with time zone DEFAULT now() NOT NULL,
  atualizado_em timestamp with time zone DEFAULT now() NOT NULL,
  responsavel text,
  loja_material text,
  data_entrega_material date,
  tentativas integer DEFAULT 0 NOT NULL,
  materiais_necessarios jsonb DEFAULT '[]'::jsonb NOT NULL,
  tracking_ref text,
  origem_plataforma text,
  origem_campanha_id text,
  origem_campanha_nome text,
  origem_grupo_id text,
  origem_grupo_nome text,
  origem_anuncio_id text,
  origem_palavra_chave text,
  origem_match_type text,
  origem_dispositivo text,
  gclid text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  landing_page text,
  origem_primeiro_toque jsonb DEFAULT '{}'::jsonb NOT NULL,
  origem_ultimo_toque jsonb DEFAULT '{}'::jsonb NOT NULL,
  gbraid text,
  wbraid text
);

CREATE TABLE public.usuarios_autorizados (
  user_id uuid NOT NULL,
  email text,
  criado_em timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINTS LOCAIS PRIMEIRO (PK/UNIQUE/CHECK)
ALTER TABLE public.agenda ADD CONSTRAINT agenda_pkey PRIMARY KEY (id);
ALTER TABLE public.agenda ADD CONSTRAINT agenda_presencial_precisa_hora_cidade CHECK (tipo IS DISTINCT FROM 'presencial'::text OR hora IS NOT NULL AND cidade IS NOT NULL AND btrim(cidade) <> ''::text) NOT VALID;
ALTER TABLE public.agenda ADD CONSTRAINT agenda_status_check CHECK (status = ANY (ARRAY['planejado'::text, 'feito'::text, 'cancelado'::text]));
ALTER TABLE public.caixa_entrada ADD CONSTRAINT caixa_entrada_pkey PRIMARY KEY (id);
ALTER TABLE public.clientes ADD CONSTRAINT clientes_pkey PRIMARY KEY (id);
ALTER TABLE public.clientes ADD CONSTRAINT clientes_telefone_celular_br CHECK (telefone IS NULL OR regexp_replace(telefone, '\D'::text, ''::text, 'g'::text) ~ '^55[1-9][0-9]9[6-9][0-9]{7}$'::text) NOT VALID;
ALTER TABLE public.config ADD CONSTRAINT config_id_check CHECK (id = 1);
ALTER TABLE public.config ADD CONSTRAINT config_pkey PRIMARY KEY (id);
ALTER TABLE public.dividas ADD CONSTRAINT dividas_pkey PRIMARY KEY (id);
ALTER TABLE public.dividas ADD CONSTRAINT dividas_status_check CHECK (status = ANY (ARRAY['aberta'::text, 'quitada'::text]));
ALTER TABLE public.estoque ADD CONSTRAINT estoque_pkey PRIMARY KEY (id);
ALTER TABLE public.financeiro ADD CONSTRAINT financeiro_escopo_check CHECK (escopo = ANY (ARRAY['empresa'::text, 'pro_labore'::text, 'pessoal'::text]));
ALTER TABLE public.financeiro ADD CONSTRAINT financeiro_material_precisa_fornecedor CHECK (categoria IS DISTINCT FROM 'Material'::text OR fornecedor_id IS NOT NULL) NOT VALID;
ALTER TABLE public.financeiro ADD CONSTRAINT financeiro_pkey PRIMARY KEY (id);
ALTER TABLE public.financeiro ADD CONSTRAINT financeiro_status_check CHECK (status = ANY (ARRAY['pago'::text, 'a_receber'::text, 'a_pagar'::text]));
ALTER TABLE public.financeiro ADD CONSTRAINT financeiro_tipo_check CHECK (tipo = ANY (ARRAY['entrada'::text, 'saida'::text]));
ALTER TABLE public.fornecedores ADD CONSTRAINT fornecedores_pkey PRIMARY KEY (id);
ALTER TABLE public.fotos ADD CONSTRAINT fotos_pkey PRIMARY KEY (id);
ALTER TABLE public.fotos ADD CONSTRAINT fotos_tipo_check CHECK (tipo = ANY (ARRAY['antes'::text, 'depois'::text, 'orcamento'::text, 'outro'::text]));
ALTER TABLE public.github_change_requests ADD CONSTRAINT gcr_arquivos_e_lista CHECK (jsonb_typeof(arquivos) = 'array'::text AND jsonb_array_length(arquivos) >= 1 AND jsonb_array_length(arquivos) <= 20);
ALTER TABLE public.github_change_requests ADD CONSTRAINT gcr_base_nao_e_saida CHECK (branch IS NULL OR branch <> base_branch);
ALTER TABLE public.github_change_requests ADD CONSTRAINT gcr_branch_prefixada CHECK (branch IS NULL OR branch ~~ 'classic/%'::text);
ALTER TABLE public.github_change_requests ADD CONSTRAINT gcr_repositorio_permitido CHECK (repository = 'dieegguin-byte/painel'::text);
ALTER TABLE public.github_change_requests ADD CONSTRAINT gcr_status_valido CHECK (status = ANY (ARRAY['pendente'::text, 'processando'::text, 'concluido'::text, 'erro'::text]));
ALTER TABLE public.github_change_requests ADD CONSTRAINT github_change_requests_idempotency_key_key UNIQUE (idempotency_key);
ALTER TABLE public.github_change_requests ADD CONSTRAINT github_change_requests_pkey PRIMARY KEY (id);
ALTER TABLE public.guia_ia ADD CONSTRAINT guia_ia_pkey PRIMARY KEY (id);
ALTER TABLE public.guia_ia ADD CONSTRAINT guia_ia_secao_check CHECK (secao = ANY (ARRAY['empresa'::text, 'como_agir'::text, 'regras'::text]));
ALTER TABLE public.guia_ia ADD CONSTRAINT guia_ia_secao_key UNIQUE (secao);
ALTER TABLE public.historico ADD CONSTRAINT historico_pkey PRIMARY KEY (id);
ALTER TABLE public.historico ADD CONSTRAINT historico_por_check CHECK (por = ANY (ARRAY['diego'::text, 'claude'::text]));
ALTER TABLE public.marketing_atribuicoes ADD CONSTRAINT marketing_atribuicoes_pkey PRIMARY KEY (id);
ALTER TABLE public.marketing_atribuicoes ADD CONSTRAINT marketing_atribuicoes_tracking_ref_key UNIQUE (tracking_ref);
ALTER TABLE public.rotinas ADD CONSTRAINT rotinas_pkey PRIMARY KEY (id);
ALTER TABLE public.servicos ADD CONSTRAINT servicos_ativo_precisa_prazo CHECK (prazo IS NOT NULL OR (status = ANY (ARRAY['entregue'::text, 'perdido'::text])));
ALTER TABLE public.servicos ADD CONSTRAINT servicos_entregue_precisa_valor CHECK (status <> 'entregue'::text OR valor_orcamento IS NOT NULL) NOT VALID;
ALTER TABLE public.servicos ADD CONSTRAINT servicos_pkey PRIMARY KEY (id);
ALTER TABLE public.servicos ADD CONSTRAINT servicos_prioridade_check CHECK (prioridade = ANY (ARRAY['alta'::text, 'media'::text, 'baixa'::text]));
ALTER TABLE public.servicos ADD CONSTRAINT servicos_status_check CHECK (status = ANY (ARRAY['lead'::text, 'orcamento'::text, 'agendado'::text, 'producao'::text, 'entregue'::text, 'pago'::text, 'perdido'::text]));
ALTER TABLE public.usuarios_autorizados ADD CONSTRAINT usuarios_autorizados_pkey PRIMARY KEY (user_id);

-- FOREIGN KEYS DEPOIS QUE TODAS AS PK/UNIQUE EXISTEM
ALTER TABLE public.agenda ADD CONSTRAINT agenda_servico_id_fkey FOREIGN KEY (servico_id) REFERENCES servicos(id) ON DELETE SET NULL;
ALTER TABLE public.dividas ADD CONSTRAINT dividas_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clientes(id);
ALTER TABLE public.dividas ADD CONSTRAINT dividas_fornecedor_id_fkey FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id);
ALTER TABLE public.financeiro ADD CONSTRAINT financeiro_agenda_id_fkey FOREIGN KEY (agenda_id) REFERENCES agenda(id) ON DELETE SET NULL;
ALTER TABLE public.financeiro ADD CONSTRAINT financeiro_fornecedor_id_fkey FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id) ON DELETE SET NULL;
ALTER TABLE public.financeiro ADD CONSTRAINT financeiro_servico_id_fkey FOREIGN KEY (servico_id) REFERENCES servicos(id) ON DELETE SET NULL;
ALTER TABLE public.fotos ADD CONSTRAINT fotos_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE;
ALTER TABLE public.fotos ADD CONSTRAINT fotos_servico_id_fkey FOREIGN KEY (servico_id) REFERENCES servicos(id) ON DELETE CASCADE;
ALTER TABLE public.servicos ADD CONSTRAINT servicos_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL;
ALTER TABLE public.usuarios_autorizados ADD CONSTRAINT usuarios_autorizados_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- INDICES NAO CRIADOS POR CONSTRAINTS
CREATE UNIQUE INDEX agenda_sem_duplicata ON public.agenda USING btree (servico_id, titulo, data) WHERE (servico_id IS NOT NULL);
CREATE INDEX idx_agenda_servico_id ON public.agenda USING btree (servico_id);
CREATE INDEX idx_caixa_entrada_aberta_criado_em ON public.caixa_entrada USING btree (criado_em) WHERE (processado IS FALSE);
CREATE UNIQUE INDEX clientes_telefone_unico ON public.clientes USING btree (regexp_replace(telefone, '\D'::text, ''::text, 'g'::text)) WHERE (telefone IS NOT NULL);
CREATE INDEX idx_dividas_cliente_id ON public.dividas USING btree (cliente_id);
CREATE INDEX idx_dividas_fornecedor_id ON public.dividas USING btree (fornecedor_id);
CREATE INDEX financeiro_agenda_id_idx ON public.financeiro USING btree (agenda_id);
CREATE INDEX financeiro_fornecedor_id_idx ON public.financeiro USING btree (fornecedor_id);
CREATE INDEX financeiro_servico_id_idx ON public.financeiro USING btree (servico_id);
CREATE INDEX idx_fotos_cliente_id ON public.fotos USING btree (cliente_id);
CREATE INDEX idx_fotos_servico_id ON public.fotos USING btree (servico_id);
CREATE INDEX gcr_pendentes ON public.github_change_requests USING btree (criado_em) WHERE (status = ANY (ARRAY['pendente'::text, 'processando'::text]));
CREATE INDEX idx_marketing_atribuicoes_criado_em ON public.marketing_atribuicoes USING btree (criado_em DESC);
CREATE INDEX idx_marketing_atribuicoes_gclid ON public.marketing_atribuicoes USING btree (gclid) WHERE (gclid IS NOT NULL);
CREATE INDEX marketing_atribuicoes_gbraid_idx ON public.marketing_atribuicoes USING btree (gbraid) WHERE (gbraid IS NOT NULL);
CREATE INDEX marketing_atribuicoes_wbraid_idx ON public.marketing_atribuicoes USING btree (wbraid) WHERE (wbraid IS NOT NULL);
CREATE INDEX idx_servicos_cliente_id ON public.servicos USING btree (cliente_id);
CREATE INDEX idx_servicos_gclid ON public.servicos USING btree (gclid) WHERE (gclid IS NOT NULL);
CREATE INDEX idx_servicos_origem_campanha_id ON public.servicos USING btree (origem_campanha_id) WHERE (origem_campanha_id IS NOT NULL);
CREATE INDEX idx_servicos_tracking_ref ON public.servicos USING btree (tracking_ref) WHERE (tracking_ref IS NOT NULL);
CREATE INDEX servicos_gbraid_idx ON public.servicos USING btree (gbraid) WHERE (gbraid IS NOT NULL);
CREATE INDEX servicos_wbraid_idx ON public.servicos USING btree (wbraid) WHERE (wbraid IS NOT NULL);

-- FUNCOES LEGADAS
CREATE OR REPLACE FUNCTION public.usuario_autorizado()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (select 1 from public.usuarios_autorizados u where u.user_id = auth.uid());
$function$

CREATE OR REPLACE FUNCTION public.gcr_dispara_executor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $function$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'GITHUB_BRIDGE_URL' limit 1;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'GITHUB_BRIDGE_SECRET' limit 1;

  if v_url is null or v_secret is null then
    raise warning 'ponte github: segredo ausente no Vault; pedido % ficou pendente', new.id;
    return new;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type',    'application/json',
                 'x-bridge-secret', v_secret
               ),
    body    := jsonb_build_object('request_id', new.id),
    timeout_milliseconds := 55000
  );

  return new;
end;
$function$

CREATE OR REPLACE FUNCTION public.gcr_protege_concluido()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if old.status = 'concluido' then
    if new.arquivos is distinct from old.arquivos
       or new.commit_message is distinct from old.commit_message
       or new.repository is distinct from old.repository
       or new.branch is distinct from old.branch
       or new.commit_sha is distinct from old.commit_sha
       or new.pr_url is distinct from old.pr_url
       or new.status is distinct from old.status then
      raise exception 'pedido % ja foi concluido (PR %); abra um pedido novo', old.id, coalesce(old.pr_url, '-');
    end if;
  end if;

  new.atualizado_em := now();
  return new;
end;
$function$

CREATE OR REPLACE FUNCTION public.gcr_valida_pedido()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  item        jsonb;
  caminho     text;
  conteudo    text;
  total_bytes bigint := 0;
begin
  if new.commit_message is null or btrim(new.commit_message) = '' then
    raise exception 'commit_message nao pode ser vazio';
  end if;

  if new.motivo is null or btrim(new.motivo) = '' then
    raise exception 'motivo nao pode ser vazio';
  end if;

  for item in select * from jsonb_array_elements(new.arquivos) loop
    if jsonb_typeof(item) <> 'object' then
      raise exception 'cada item de arquivos precisa ser um objeto {path, content}';
    end if;

    caminho  := item ->> 'path';
    conteudo := item ->> 'content';

    if caminho is null or btrim(caminho) = '' then
      raise exception 'arquivo sem path';
    end if;

    if conteudo is null then
      raise exception 'arquivo % sem content', caminho;
    end if;

    if caminho like '/%' or caminho like '%..%' or caminho like '%\%' then
      raise exception 'path invalido: % (nao pode ser absoluto, conter .. nem barra invertida)', caminho;
    end if;

    if caminho like '.git/%' or caminho like '.github/workflows/%' then
      raise exception 'path fora do alcance da ponte: %', caminho;
    end if;

    if length(caminho) > 200 then
      raise exception 'path longo demais: % caracteres', length(caminho);
    end if;

    if octet_length(conteudo) > 1572864 then
      raise exception 'arquivo % tem % bytes; o limite por arquivo e 1572864', caminho, octet_length(conteudo);
    end if;

    total_bytes := total_bytes + octet_length(conteudo);
  end loop;

  if total_bytes > 3145728 then
    raise exception 'pedido com % bytes no total; o limite e 3145728', total_bytes;
  end if;

  return new;
end;
$function$

CREATE OR REPLACE FUNCTION public.trava_agenda_feito_no_futuro()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.status = 'feito' and new.data > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Compromisso de % ainda nao aconteceu - nao pode virar feito. Se saiu da agenda, apague ou reagende; se ja resolveu antes da hora, mude a data.', new.data;
  end if;
  return new;
end $function$

CREATE OR REPLACE FUNCTION public.trava_caixa_print_precisa_ser_lido()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.processado = true
     and coalesce(old.processado, false) = false
     and new.texto like '%[[TB_INBOX_IMG]]%'
     and not exists (
       select 1
       from jsonb_array_elements(coalesce(new.conversa::jsonb, '[]'::jsonb)) as m
       where (m -> 'meta' ->> 'print_lido') = 'true'
     ) then
    raise exception
      'Este item tem print e nada registra que ele foi aberto. Abra a imagem, leia o que esta nela (nome, telefone, cidade, material, medidas) e grave em conversa uma mensagem com meta {"print_lido": true} antes de processar. REGRA No 1 — foi assim que o print da Wesliane passou batido em 04/08 e o servico dela ficou sem material.';
  end if;
  return new;
end $function$


-- RLS
ALTER TABLE public.agenda ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caixa_entrada ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dividas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estoque ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financeiro ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fornecedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fotos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guia_ia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_atribuicoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rotinas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.servicos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios_autorizados ENABLE ROW LEVEL SECURITY;

-- POLICIES ATUAIS (LEGADO; HARDENING V4 VEM DEPOIS)
CREATE POLICY auth_all ON public.agenda AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY auth_all ON public.caixa_entrada AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY auth_all ON public.clientes AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY auth_all ON public.config AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY dividas_authenticated_all ON public.dividas AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY auth_all ON public.estoque AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY auth_all ON public.financeiro AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY operador_autorizado ON public.fornecedores AS PERMISSIVE FOR ALL TO authenticated USING (( SELECT usuario_autorizado() AS usuario_autorizado)) WITH CHECK (( SELECT usuario_autorizado() AS usuario_autorizado));
CREATE POLICY auth_all ON public.fotos AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY operador_autorizado ON public.github_change_requests AS PERMISSIVE FOR ALL TO authenticated USING (( SELECT usuario_autorizado() AS usuario_autorizado)) WITH CHECK (( SELECT usuario_autorizado() AS usuario_autorizado));
CREATE POLICY auth_all ON public.guia_ia AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY auth_all ON public.historico AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY auth_all ON public.rotinas AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_all ON public.servicos AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'authenticated'::text)) WITH CHECK ((auth.role() = 'authenticated'::text));
CREATE POLICY autorizado_le_a_si ON public.usuarios_autorizados AS PERMISSIVE FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));

-- VIEWS
CREATE VIEW public.vw_marketing_funil WITH (security_invoker=true) AS
 SELECT COALESCE(NULLIF(origem_plataforma, ''::text), 'nao_identificada'::text) AS origem_plataforma,
    origem_campanha_id,
    origem_campanha_nome,
    landing_page,
    count(*) AS qtd_total,
    count(*) FILTER (WHERE status = 'lead'::text) AS qtd_lead,
    count(*) FILTER (WHERE status = 'orcamento'::text) AS qtd_orcamento,
    count(*) FILTER (WHERE status = 'agendado'::text) AS qtd_agendado,
    count(*) FILTER (WHERE status = 'producao'::text) AS qtd_producao,
    count(*) FILTER (WHERE status = 'entregue'::text) AS qtd_entregue,
    count(*) FILTER (WHERE status = 'pago'::text) AS qtd_pago,
    count(*) FILTER (WHERE status = 'perdido'::text) AS qtd_perdido,
    COALESCE(sum(valor_orcamento), 0::numeric) AS valor_orcamento_total,
    COALESCE(sum(valor_orcamento) FILTER (WHERE status = 'orcamento'::text), 0::numeric) AS valor_em_orcamento,
    COALESCE(sum(valor_orcamento) FILTER (WHERE status = 'producao'::text), 0::numeric) AS valor_em_producao,
    COALESCE(sum(valor_orcamento) FILTER (WHERE status = 'entregue'::text), 0::numeric) AS valor_entregue
   FROM servicos
  WHERE tracking_ref IS NOT NULL OR origem_campanha_id IS NOT NULL OR origem_plataforma IS NOT NULL OR gclid IS NOT NULL OR gbraid IS NOT NULL OR wbraid IS NOT NULL OR utm_source IS NOT NULL
  GROUP BY (COALESCE(NULLIF(origem_plataforma, ''::text), 'nao_identificada'::text)), origem_campanha_id, origem_campanha_nome, landing_page;

-- TRIGGERS
CREATE TRIGGER trg_agenda_feito_no_futuro BEFORE INSERT OR UPDATE ON agenda FOR EACH ROW EXECUTE FUNCTION trava_agenda_feito_no_futuro();
CREATE TRIGGER trg_caixa_print_precisa_ser_lido BEFORE INSERT OR UPDATE ON caixa_entrada FOR EACH ROW EXECUTE FUNCTION trava_caixa_print_precisa_ser_lido();
CREATE TRIGGER trg_gcr_dispara_executor AFTER INSERT ON github_change_requests FOR EACH ROW EXECUTE FUNCTION gcr_dispara_executor();
CREATE TRIGGER trg_gcr_protege_concluido BEFORE UPDATE ON github_change_requests FOR EACH ROW EXECUTE FUNCTION gcr_protege_concluido();
CREATE TRIGGER trg_gcr_valida_pedido BEFORE INSERT OR UPDATE OF arquivos, commit_message, motivo ON github_change_requests FOR EACH ROW EXECUTE FUNCTION gcr_valida_pedido();

-- GRANTS COMPATIVEIS COM O ESTADO ATUAL
GRANT ALL ON TABLE public.agenda TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.caixa_entrada TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.clientes TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.config TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.dividas TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.estoque TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.financeiro TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.fornecedores TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.fotos TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.github_change_requests TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.guia_ia TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.historico TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.rotinas TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.servicos TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.usuarios_autorizados TO anon, authenticated, service_role;
REVOKE ALL ON TABLE public.marketing_atribuicoes FROM anon, authenticated;
GRANT ALL ON TABLE public.marketing_atribuicoes TO service_role;
GRANT ALL ON TABLE public.vw_marketing_funil TO anon, authenticated, service_role;

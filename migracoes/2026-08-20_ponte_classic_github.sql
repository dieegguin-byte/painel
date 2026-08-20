-- ============================================================================
-- MIGRAÇÃO 2026-08-20 — Ponte Classic → GitHub (fila de alterações de código)
--
-- POR QUE ESTE ARQUIVO EXISTE: o ChatGPT Classic lê o repositório
-- dieegguin-byte/painel normalmente, mas TODA tentativa de escrita pelo conector
-- GitHub dele volta 403 "Resource not accessible by integration" — criar branch,
-- criar arquivo e até abrir issue. O diagnóstico está no documento do Drive
-- "TAREFA TÉCNICA — Ponte Classic → GitHub para editar o app" (18/08/2026).
--
-- A saída combinada: o Classic para de tentar escrever direto e passa a PEDIR.
-- Ele grava uma linha nesta fila (SQL, que é o que comprovadamente funciona pra
-- ele) e um executor server-side faz o trabalho no GitHub:
--
--     Classic → esta fila → Edge Function github-bridge → branch → commit → PR
--
-- O QUE ISSO COMPRA: o Classic nunca precisa possuir token do GitHub. O token
-- vive só nos Secrets da Edge Function. Se a conta do ChatGPT for comprometida,
-- o atacante consegue no máximo enfileirar um Pull Request num único repositório
-- — não consegue escrever na main, não consegue fazer merge e não consegue tocar
-- em nenhum outro repositório.
--
-- COMO RODAR: Supabase > SQL Editor > cola o arquivo inteiro > Run.
-- Rodar duas vezes não faz mal.
--
-- O QUE ESTA MIGRAÇÃO NÃO FAZ: não apaga nada, não altera nenhuma tabela
-- existente e não encosta em cliente, serviço, agenda, material ou financeiro.
-- Ela só acrescenta uma tabela nova e as travas dela.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. pg_net — como o banco acorda o executor
--
-- Sem isto, o Classic teria que fazer uma chamada HTTP depois do INSERT, e pra
-- isso precisaria guardar um segredo do nosso lado dentro do ChatGPT. Com pg_net,
-- o gatilho parte de DENTRO do banco: o Classic só faz INSERT e vai embora.
-- Nenhum segredo novo passa a existir fora do Supabase.
-- ----------------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;


-- ----------------------------------------------------------------------------
-- 2. A fila
--
-- Uma linha = um pedido de alteração = no máximo um Pull Request.
--
-- Sobre `idempotency_key`: é ela que impede o pedido repetido virar dois PRs.
-- O Classic monta uma chave estável a partir do que está pedindo (por exemplo
-- "botao-x-2026-08-20"); se ele reenviar a mesma coisa por qualquer motivo —
-- timeout, retentativa, Diego pedindo duas vezes — o UNIQUE recusa a segunda
-- linha e o resultado da primeira continua valendo.
-- ----------------------------------------------------------------------------
create table if not exists public.github_change_requests (
  id               uuid primary key default gen_random_uuid(),
  idempotency_key  text not null unique,

  -- alvo
  repository       text not null default 'dieegguin-byte/painel',
  base_branch      text not null default 'main',
  arquivos         jsonb not null,
  commit_message   text not null,
  motivo           text not null,

  -- quem pediu (auditoria; não é autenticação)
  solicitado_por   text not null default 'classic',

  -- resultado, preenchido pelo executor
  status           text not null default 'pendente',
  branch           text,
  commit_sha       text,
  pr_number        integer,
  pr_url           text,
  erro             text,
  tentativas       integer not null default 0,

  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  processado_em    timestamptz
);

comment on table public.github_change_requests is
  'Fila de alterações de código pedidas pelo ChatGPT Classic. O executor é a Edge Function github-bridge. Ver migracoes/2026-08-20_ponte_classic_github.sql.';


-- ----------------------------------------------------------------------------
-- 3. Travas declarativas
--
-- Estas são as que o Postgres consegue garantir sozinho, sem depender de o
-- executor lembrar de conferir. O executor confere tudo de novo do lado dele
-- (defesa em profundidade), mas o banco é quem tem a palavra final.
-- ----------------------------------------------------------------------------

-- Um repositório só. Ampliar isto é uma decisão consciente, não um acidente.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gcr_repositorio_permitido') then
    alter table public.github_change_requests
      add constraint gcr_repositorio_permitido
      check (repository = 'dieegguin-byte/painel');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gcr_status_valido') then
    alter table public.github_change_requests
      add constraint gcr_status_valido
      check (status in ('pendente', 'processando', 'concluido', 'erro'));
  end if;
end $$;

-- A branch de saída SEMPRE mora debaixo de classic/. Isto é o que garante, no
-- nível do schema, que a ponte não tem como escrever na main mesmo que o
-- executor tenha um bug.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gcr_branch_prefixada') then
    alter table public.github_change_requests
      add constraint gcr_branch_prefixada
      check (branch is null or branch like 'classic/%');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gcr_base_nao_e_saida') then
    alter table public.github_change_requests
      add constraint gcr_base_nao_e_saida
      check (branch is null or branch <> base_branch);
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gcr_arquivos_e_lista') then
    alter table public.github_change_requests
      add constraint gcr_arquivos_e_lista
      check (
        jsonb_typeof(arquivos) = 'array'
        and jsonb_array_length(arquivos) between 1 and 20
      );
  end if;
end $$;

create index if not exists gcr_pendentes
  on public.github_change_requests (criado_em)
  where status in ('pendente', 'processando');


-- ----------------------------------------------------------------------------
-- 4. Validação do conteúdo do pedido
--
-- O que um CHECK não alcança: olhar dentro de cada item da lista de arquivos.
-- É aqui que mora a defesa contra path traversal — sem isto, um `path` como
-- "../../.github/workflows/deploy.yml" sairia do repositório ou reescreveria a
-- automação de deploy.
--
-- Os limites de tamanho existem porque o payload trafega inteiro pela memória da
-- Edge Function. 1,5 MB por arquivo deixa o nova.html (≈470 KB hoje) caber com
-- muita folga.
-- ----------------------------------------------------------------------------
create or replace function public.gcr_valida_pedido()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  item        jsonb;
  caminho     text;
  conteudo    text;
  total_bytes bigint := 0;
begin
  if new.commit_message is null or btrim(new.commit_message) = '' then
    raise exception 'commit_message não pode ser vazio';
  end if;

  if new.motivo is null or btrim(new.motivo) = '' then
    raise exception 'motivo não pode ser vazio — é ele que explica o PR pro Diego depois';
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
      raise exception 'arquivo % sem content (para apagar arquivo a ponte não serve — isso é conversa com o Diego)', caminho;
    end if;

    -- path traversal e caminhos absolutos
    if caminho like '/%' or caminho like '%..%' or caminho like '%\%' then
      raise exception 'path inválido: % (não pode ser absoluto, conter .. nem barra invertida)', caminho;
    end if;

    -- (não existe checagem de byte nulo aqui de propósito: `text` no Postgres não
    -- consegue conter byte nulo, e a tentativa de testar com chr(0) derruba a
    -- própria função com "null character not permitted" — foi o que o teste desta
    -- migração pegou em 20/08, recusando até pedido legítimo.)

    -- o encanamento do próprio repositório fica fora do alcance da ponte:
    -- um workflow do Actions é código que roda com as credenciais do repo.
    if caminho like '.git/%' or caminho like '.github/workflows/%' then
      raise exception 'path fora do alcance da ponte: % (mexer em .git/ ou em workflow do Actions é manual)', caminho;
    end if;

    if length(caminho) > 200 then
      raise exception 'path longo demais: % caracteres', length(caminho);
    end if;

    if octet_length(conteudo) > 1572864 then  -- 1,5 MB
      raise exception 'arquivo % tem % bytes; o limite por arquivo é 1572864', caminho, octet_length(conteudo);
    end if;

    total_bytes := total_bytes + octet_length(conteudo);
  end loop;

  if total_bytes > 3145728 then  -- 3 MB
    raise exception 'pedido com % bytes no total; o limite é 3145728', total_bytes;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_gcr_valida_pedido on public.github_change_requests;
create trigger trg_gcr_valida_pedido
  before insert or update of arquivos, commit_message, motivo
  on public.github_change_requests
  for each row execute function public.gcr_valida_pedido();


-- ----------------------------------------------------------------------------
-- 5. O resultado é imutável
--
-- Depois que um pedido virou PR, ele não pode ser reescrito pra apontar pra
-- outro lugar — senão a auditoria mente. Quem quiser mudar de ideia abre um
-- pedido novo.
-- ----------------------------------------------------------------------------
create or replace function public.gcr_protege_concluido()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status = 'concluido' then
    if new.arquivos is distinct from old.arquivos
       or new.commit_message is distinct from old.commit_message
       or new.repository is distinct from old.repository
       or new.branch is distinct from old.branch
       or new.commit_sha is distinct from old.commit_sha
       or new.pr_url is distinct from old.pr_url
       or new.status is distinct from old.status then
      raise exception 'pedido % já foi concluído (PR %); abra um pedido novo em vez de reescrever este', old.id, coalesce(old.pr_url, '—');
    end if;
  end if;

  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists trg_gcr_protege_concluido on public.github_change_requests;
create trigger trg_gcr_protege_concluido
  before update on public.github_change_requests
  for each row execute function public.gcr_protege_concluido();


-- ----------------------------------------------------------------------------
-- 6. RLS — mesma régua da tabela fornecedores
--
-- A chave publicável que vive dentro do nova.html chega até aqui. Sem RLS,
-- qualquer pessoa que abrisse o app conseguiria enfileirar uma alteração de
-- código. A política pergunta pela lista de operadores autorizados, igual ao que
-- a revisão de 15/08 fez em fornecedores.
--
-- O Classic não passa por esta política: ele fala com o banco pela porta
-- administrativa, que roda acima do RLS. A política protege o navegador.
-- ----------------------------------------------------------------------------
alter table public.github_change_requests enable row level security;

drop policy if exists operador_autorizado on public.github_change_requests;
create policy operador_autorizado
  on public.github_change_requests
  for all
  to authenticated
  using ((select public.usuario_autorizado()))
  with check ((select public.usuario_autorizado()));


-- ----------------------------------------------------------------------------
-- 7. O gatilho que acorda o executor
--
-- Os dois segredos ficam no Vault do Supabase, criptografados, e nunca aparecem
-- no app, no Drive nem em log:
--
--   GITHUB_BRIDGE_URL     — endereço da Edge Function
--   GITHUB_BRIDGE_SECRET  — senha que a função exige pra atender
--
-- Enquanto eles não existirem, o INSERT continua funcionando e a linha fica
-- `pendente`. Isso é de propósito: falha de disparo não pode derrubar a
-- gravação do pedido. O pedido parado é visível e pode ser drenado depois.
-- ----------------------------------------------------------------------------
create or replace function public.gcr_dispara_executor()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault, pg_temp
as $$
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
$$;

drop trigger if exists trg_gcr_dispara_executor on public.github_change_requests;
create trigger trg_gcr_dispara_executor
  after insert on public.github_change_requests
  for each row execute function public.gcr_dispara_executor();


-- ----------------------------------------------------------------------------
-- 8. Conferência
-- ----------------------------------------------------------------------------
select
  (select count(*) from pg_extension where extname = 'pg_net')                          as pg_net_instalado,
  (select count(*) from pg_tables where tablename = 'github_change_requests')           as tabela_criada,
  (select relrowsecurity from pg_class where relname = 'github_change_requests')        as rls_ligado,
  (select count(*) from pg_policies where tablename = 'github_change_requests')         as politicas,
  (select count(*) from pg_constraint where conrelid = 'public.github_change_requests'::regclass
     and contype = 'c')                                                                 as checks,
  (select count(*) from pg_trigger where tgrelid = 'public.github_change_requests'::regclass
     and not tgisinternal)                                                              as gatilhos,
  (select count(*) from vault.decrypted_secrets
     where name in ('GITHUB_BRIDGE_URL', 'GITHUB_BRIDGE_SECRET'))                       as segredos_no_vault;

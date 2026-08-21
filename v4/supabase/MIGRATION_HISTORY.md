# V4 Supabase — alinhamento do histórico de migrations

## Estado validado em 2026-08-21

Projeto remoto de staging: `recmmjglkbcedqkajnzw` (`Operacao Bahia V4 Staging`).

O schema de staging foi reconstruído e validado antes de existir um fluxo CLI ligado ao projeto. Por isso, os dois arquivos abaixo representam mudanças que **já existem fisicamente no staging**, enquanto `supabase_migrations.schema_migrations` ainda está vazio:

- `20260821023000_baseline_v3_schema.sql`
- `20260821025000_v4_p0_harden_rls.sql`

A baseline foi comparada contra produção antes do hardening e bateu exatamente: 305 objetos e fingerprint SHA-256 `76b69d58b169752390f163928566e021e4ad49ecc5c33a98620c2d5ffbaacd63`.

## Regra

Não reaplicar estas migrations sobre o staging atual e não inserir linhas manualmente em `supabase_migrations.schema_migrations`.

O mecanismo oficial para dizer ao Supabase que uma migration já está materializada é `migration repair`.

## Procedimento quando houver Supabase CLI

Na raiz do projeto V4, usando a pasta que contém `supabase/config.toml`/`migrations`:

```bash
supabase login
supabase link --project-ref recmmjglkbcedqkajnzw
supabase migration list
supabase migration repair --status applied 20260821023000
supabase migration repair --status applied 20260821025000
supabase migration list
```

Depois do repair, o remoto deve listar as duas migrations como aplicadas. Somente então usar `supabase db push` para migrations posteriores.

## Teste destrutivo obrigatório no DEV local

O staging não substitui o teste de reconstrução local. Quando Docker/Supabase CLI estiver disponível:

```bash
supabase start
supabase db reset
```

O reset deve executar migrations + `seed.sql` do zero. O seed não cria usuários diretamente em `auth.users`; contas Auth de teste devem ser criadas pela API oficial do Supabase Auth e adicionadas a `public.usuarios_autorizados`.

## Segurança

- Nunca executar `migration repair` em produção para estas migrations V4.
- Nunca rodar a migration de hardening V4 em produção sem teste de compatibilidade da V3 e autorização explícita.
- Nunca usar `service_role`/secret key no frontend.
- Produção não é staging.

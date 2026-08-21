# Estado do staging V4

**Ambiente:** Operacao Bahia V4 Staging  
**Regiao:** us-east-2  
**Custo confirmado na criacao:** US$ 0/mes  
**Dados:** somente fixtures sinteticas.

## Banco

- baseline V3 reproduzida com fingerprint identico ao capturado da producao antes do hardening;
- 305 objetos no contrato estrutural;
- smoke test da baseline: OK;
- hardening P0 aplicado somente aqui;
- RLS testada com usuario autorizado e autenticado fora da allowlist;
- authenticated sem privilegio TRUNCATE;
- advisor de seguranca: sem alerta de RLS/SECURITY DEFINER exposta; resta apenas leaked-password protection do Auth;
- advisor de performance: apenas indices sem uso, esperado em staging novo.

## Edge Function

`v4-shadow-read` esta ACTIVE no staging e exige JWT (`verify_jwt=true`).

Contrato atual:

- GET somente;
- autentica com `@supabase/server@1.4.1` / `auth: user`;
- verifica `usuarios_autorizados` via cliente RLS-scoped;
- usa apenas `ctx.supabase`;
- nao usa `ctx.supabaseAdmin`;
- executa apenas SELECT em clientes, servicos, agenda e financeiro;
- limita cada conjunto a no maximo 500 linhas;
- aceita filtro opcional `from=YYYY-MM-DD` em agenda/financeiro;
- resposta `Cache-Control: no-store`.

A chamada HTTP end-to-end autenticada ainda nao foi validada porque o staging nao possui sessao real de usuario configurada neste fluxo. O deploy e a configuracao do Supabase foram confirmados; o teste E2E fica como proximo gate antes de conectar a interface V4.

## Producao

Nenhuma Edge Function, policy, migration ou dado da producao foi alterado nesta etapa.

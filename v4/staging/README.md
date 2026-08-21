# V4 Staging UI

Tela conectada ao projeto **Operacao Bahia V4 Staging**.

## Contrato de segurança
- login via Supabase Auth do staging;
- publishable key pode ficar no frontend;
- a senha de staging não é versionada;
- dados operacionais entram somente por `GET /functions/v1/v4-shadow-read`;
- a Edge Function usa `@supabase/server` com `auth: "user"` e RLS;
- `verify_jwt=false` é intencional: a autenticação é feita pelo `@supabase/server`;
- nenhuma chamada `insert`, `update`, `delete`, `upsert` ou RPC existe na UI;
- a API não retorna nome, telefone, endereço ou observações de clientes;
- produção não é referenciada por URL ou chave.

## E2E validado em 2026-08-21
Fluxo real testado no staging: `Auth password -> JWT -> v4-shadow-read -> RLS -> 2 clientes / 2 serviços / 1 agenda / 2 financeiro`.

O probe criou usuário efêmero, autenticou, validou os counts e removeu o usuário no final. O endpoint de probe foi depois inutilizado.

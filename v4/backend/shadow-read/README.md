# shadow-read — NÃO IMPLANTAR EM PRODUÇÃO AINDA

Código preparatório da API de leitura sombra da V4.

Travas:
- `@supabase/server@1.4.1` fixado;
- autenticação `auth: "user"`;
- allowlist obrigatória em `V4_SHADOW_ALLOWED_USER_IDS`;
- somente GET;
- somente SELECT de campos mínimos;
- `ctx.supabase` (caller-scoped/RLS), nunca `ctx.supabaseAdmin`;
- sem secret/service role usado pelo código;
- sem endpoints genéricos de tabela/campo;
- máximo 500 linhas por domínio;
- respostas `no-store`.

Gate de implantação: testar primeiro em branch de desenvolvimento do Supabase e provar que POST/PUT/PATCH/DELETE retornam 405 e que usuário fora da allowlist recebe 403. Não implantar na produção enquanto a fase de isolamento não for explicitamente liberada.

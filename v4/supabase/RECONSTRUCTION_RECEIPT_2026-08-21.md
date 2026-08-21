# Recibo de reconstrucao V4 - 21/08/2026

## Resultado

A V3 foi reconstruida em um segundo projeto Supabase Free isolado, usando apenas schema capturado e dados sinteticos.

- producao: nao alterada;
- staging: `Operacao Bahia V4 Staging`, mesma regiao da producao;
- custo confirmado pelo Supabase: US$ 0/mes;
- dados reais copiados: nenhum;
- fingerprint de producao: `76b69d58b169752390f163928566e021e4ad49ecc5c33a98620c2d5ffbaacd63`;
- fingerprint final do staging antes do hardening: `76b69d58b169752390f163928566e021e4ad49ecc5c33a98620c2d5ffbaacd63`;
- objetos no contrato: 305;
- smoke test: `baseline smoke: ok`.

## Falha encontrada durante a prova

A primeira baseline criava uma FK de `agenda` antes da PK de `servicos`. O Postgres recusou com erro 42830. A migration foi corrigida para criar PK/UNIQUE/CHECK antes de todas as FKs. A falha ocorreu apenas no staging vazio.

## Hardening P0 testado no staging

Depois da reproducao exata, uma migration separada foi aplicada apenas no staging:

- `usuario_autorizado()` deixou de ser SECURITY DEFINER;
- funcoes de trigger perderam EXECUTE para PUBLIC/anon/authenticated;
- anon perdeu acesso direto as tabelas operacionais;
- authenticated perdeu ALL/TRUNCATE/REFERENCES/TRIGGER;
- tabelas operacionais passaram a exigir entrada em `usuarios_autorizados`;
- `github_change_requests`: authenticated apenas SELECT/INSERT;
- `marketing_atribuicoes`: authenticated apenas SELECT quando autorizado;
- `vw_marketing_funil`: somente SELECT autenticado.

Teste adversarial: fixture autorizada le/escreve; usuario autenticado fora da allowlist ve 0 linhas e INSERT recebe RLS 42501; authenticated nao possui TRUNCATE.

O advisor de seguranca apos o hardening deixou apenas o aviso de leaked-password protection do Auth. Os avisos anteriores de SECURITY DEFINER exposta desapareceram. O advisor de performance deixou apenas indices ainda nao usados, esperado em staging recem-criado.

## Proibicao

Nada deste hardening esta autorizado para producao. A proxima etapa e conectar a V4 ao staging e validar o fluxo completo antes de propor qualquer migration para a V3.

# Supabase V4 - ambiente reproduzivel

Este diretorio nasce da captura estrutural da producao em 21/08/2026 e serve apenas para DEV/STAGING da V4.

## Regra P0

Nunca executar `db reset --linked` contra producao. A producao V3 continua intacta.

## Fluxo

1. `supabase start`
2. `supabase db reset`
3. executar `tests/schema_fingerprint.sql`
4. executar `tests/baseline_smoke.sql`
5. somente depois criar migrations V4 adicionais

A baseline preserva policies e funcoes legadas de proposito. O objetivo e provar que conseguimos reconstruir o ponto de partida; hardening vem em migration posterior e deve ser testado antes de qualquer promocao.

Fingerprint esperado da captura: `76b69d58b169752390f163928566e021e4ad49ecc5c33a98620c2d5ffbaacd63` (305 objetos no contrato).

`seed.sql` contem apenas dados sinteticos e dominios `.invalid`.

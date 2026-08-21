# P0 de hardening apos a baseline

Nao aplicar em producao nesta fase.

1. Substituir policies `auth_all`/`USING true` por autorizacao explicita.
2. Remover dependencia de `auth.role()`; usar policies `TO authenticated` + predicado real de autorizacao.
3. Tirar `usuario_autorizado()` SECURITY DEFINER do schema publico ou, no minimo, revogar EXECUTE de PUBLIC/anon e testar o acesso necessario.
4. Revisar `gcr_dispara_executor()` SECURITY DEFINER e seus grants; a ponte deve continuar isolada e allowlisted.
5. Criar campo separado de certeza da agenda (confirmado/provisorio/sugestao), sem sobrecarregar `status` planejado/feito/cancelado.
6. Corrigir por migration/teste o caso semanticamente invalido `entrada + a_pagar`; nao alterar dados reais ate regra ser aprovada.
7. Ampliar ator de `historico` de forma compativel com V3 antes de introduzir system/classic/automation/app/site/windsor.
8. Toda mudanca V4 deve seguir expand/contract enquanto V3 estiver ativa.

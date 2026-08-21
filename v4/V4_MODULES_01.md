# V4 — Módulos 01: Hoje, Clientes e Serviços

## Estado
Primeiro ciclo navegável da Operação Bahia V4 em staging, validado em 2026-08-21.

## Ambiente
- Supabase staging isolado: `recmmjglkbcedqkajnzw`
- Auth real + JWT + RLS
- leitura operacional somente via `v4-shadow-read`
- zero escrita operacional no frontend
- produção fora do caminho

## Módulos ativos
### Hoje
Motor sombra orientado a exceções. Classifica decisões como P0/P1/P2, mostra a regra usada e oferece contexto sem executar ação.

Regras iniciais:
- `entrada + empresa + a_pagar` => P0 de consistência financeira;
- `orcamento + prioridade alta` => P1 de follow-up comercial;
- `producao` => P1 de acompanhamento;
- `lead/orcamento` sem `tracking_ref` => P2 de origem sem evidência;
- agenda `planejado` => P1 enquanto não houver certeza explícita separada.

### Clientes
- lista por ID técnico e cidade;
- busca por cidade/ID;
- ficha mostra quantidade de serviços vinculados;
- shadow-read não expõe nome, telefone, endereço ou observações.

### Serviços
- filtros por status;
- busca por ID/status/próxima ação;
- status, prioridade, prazo, próxima ação, tracking e materiais;
- vínculo com cliente;
- detalhe inclui a leitura sombra aplicável.

## Fixtures de staging
Cenário atual validado via E2E `Auth -> JWT -> v4-shadow-read -> RLS`:
- 7 clientes sintéticos;
- 8 serviços sintéticos cobrindo lead, orçamento, agendado, produção, entregue, pago e perdido;
- 1 agenda;
- 3 fatos financeiros;
- 1 P0 financeiro sintético proposital para provar o gate de consistência.

## Próximos módulos bloqueados
Agenda, Compras e Financeiro aparecem como próxima fase. Nenhuma escrita deve ser habilitada até o Shadow Engine e os contratos de leitura estabilizarem.

## Gate de segurança
O frontend deste ciclo não deve conter `service_role`, `supabaseAdmin`, `.insert(`, `.update(`, `.delete(`, `.upsert(` ou `.rpc(` para Data API. Auth por senha é permitido apenas contra o projeto de staging.

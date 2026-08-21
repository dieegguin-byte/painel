# V4 — Gate de Leitura Sombra

Status: laboratório. Nenhuma conexão contínua com produção autorizada nesta fase.

## Regra
A V4 não pode considerar "somente leitura" apenas porque o código da tela não chama métodos de escrita. O transporte/credencial também precisa ser incapaz de escrever.

## Contrato mínimo
- o frontend recebe uma capability com apenas `select(table, fields, options)`;
- qualquer objeto que exponha `insert`, `update`, `delete`, `upsert`, `rpc`, `mutate` ou `write` é rejeitado pelo adaptador;
- selecionar somente os campos necessários para o shadow mode;
- não carregar telefone, endereço, observações ou texto livre de cliente quando eles não forem necessários à comparação;
- sem `service_role` no frontend;
- sem persistência de snapshot operacional em repositório público;
- divergências são calculadas em memória e não alteram a fonte.

## Mapeamento validado do legado atual
Serviços: `lead`, `orcamento`, `agendado`, `producao`, `entregue`, `pago`, `perdido`.

Agenda possui ciclo operacional `planejado`/`feito`. A certeza de agendamento (`confirmado`, `provisorio`, `sugestao`) é um conceito separado e não deve ser inferida do ciclo operacional.

Financeiro: entrada de empresa com status `pago` pode contar como receita recebida; `a_receber` não conta; uma entrada com `a_pagar` é combinação inconsistente e deve virar divergência P0.

## Próximo gate
Antes da leitura contínua do Supabase de produção, criar uma via tecnicamente read-only (endpoint/role dedicado) e testar que tentativas de escrita falham no servidor. Até lá, usar snapshots de inspeção controlada e testes locais.

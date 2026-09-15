# Agenda criada pela Caixa: identidade e retomada

O caminho **Lançar compromisso** no `index.html` e **Compromisso** na triagem do `nova.html` usa `agenda_criar_da_caixa`. A natureza é escolhida explicitamente. Para cliente, a tela exige cadastro existente por ID; o serviço escolhido precisa pertencer àquele cliente. Nome e título não resolvem identidade. O telefone segue a validação oficial de WhatsApp e nenhum nono dígito é inventado.

## Bloqueio e confirmação de identidade

`BLOQUEIO DE CADASTRO` no texto original ou numa mensagem da conversa mantém a entrada bloqueada. `conversa[].meta.tipo_operacional = "cadastro_bloqueado"` também bloqueia. Escolher avulso, pessoal ou operacional não contorna o bloqueio.

Depois de **confirmar o número real e resolver o cadastro**, quem realizou essa verificação pode acrescentar à conversa existente um evento estruturado como este, preservando todas as mensagens anteriores:

```json
{
  "de": "ia",
  "em": "<instante real da confirmação em ISO 8601>",
  "texto": "Identidade confirmada pela evidência registrada no atendimento.",
  "meta": {
    "tipo_operacional": "cadastro_validado",
    "cliente_id": "<UUID do cliente realmente confirmado>",
    "telefone_confirmado": "<WhatsApp completo confirmado>"
  }
}
```

O exemplo define o formato; não é uma confirmação operacional pronta para uso. O formulário não cria esse evento automaticamente. Não registrar confirmação com número inferido ou com base somente no nome.

A ordem do array `conversa` determina o estado atual. A confirmação posterior libera exclusivamente um compromisso classificado como **cliente**, com o mesmo `cliente_id` e o mesmo telefone atual do cadastro após remover a formatação. O telefone precisa ser válido. Um novo bloqueio posterior torna a entrada bloqueada outra vez. Confirmação incompleta, de outro cliente ou de outro telefone não libera a criação. O texto original pode permanecer como histórico.

## Gravação e escopo

- A RPC é `SECURITY INVOKER`, acessível a `authenticated`, exige `usuario_autorizado()` e respeita as políticas das tabelas.
- `agenda.caixa_entrada_id` é a origem, com FK `ON DELETE SET NULL` e índice único. Não houve preenchimento retroativo. Não é um identificador comercial.
- A RPC bloqueia a origem durante a gravação e devolve a linha lida após as travas. A tela só resolve a Caixa depois de conferir origem, status e IDs retornados.
- Repetir o mesmo pedido recupera o mesmo compromisso da mesma Caixa. Outra Caixa, mesmo com título/data iguais, não reutiliza a linha por texto. Pedido diferente para uma origem já usada exige revisão.
- Compromisso cancelado ou encerrado não é reativado nem reaproveitado. Se realmente surgir um novo pedido, ele precisa de uma nova origem operacional legítima.
- O trigger também valida `cliente_id` sem serviço, rejeita IDs conflitantes e deriva o cliente exclusivamente da FK de um serviço informado. Compromissos cancelados e avulsos sem IDs continuam permitidos.

O banco não infere se um texto livre é comercial. Uma inserção direta sem IDs e sem origem não é distinguível de um compromisso avulso legítimo; quem cria a partir da Caixa deve usar a RPC. Esta alteração não converte registros antigos nem cancela, remarca ou encerra dados operacionais existentes.

## Verificação e recuperação

Execute `node --test tests/agenda-caixa-identidade.test.mjs`. A suíte usa PostgreSQL PGlite local, sem conexão externa, e os callbacks reais das duas telas com banco simulado. Cobre telefone inválido, IDs corretos/conflitantes, bloqueio e confirmação posterior, avulsos, repetição por origem, índice único, cancelados, autorização, readback e rollback/reaplicação. O PGlite serializa sua conexão: o teste de repetição não simula duas sessões PostgreSQL reais; a garantia atômica está no bloqueio de linha e índice único.

A migração é `migracoes/20260915153735_agenda_caixa_identidade.sql`. O rollback `migracoes/rollback/agenda_caixa_identidade.sql` restaura o trigger anterior e remove a RPC, preservando a coluna de origem, os valores e o índice. Reverter também os HTML/JS do app evita oferecer um fluxo cuja RPC foi removida. Reaplicar a migração verifica o contrato da coluna e do índice antes de restaurar a RPC. Não apagar a coluna para reaplicar.

Se a Agenda foi gravada mas resolver a Caixa falhou, repetir a mesma ação recupera a linha pela origem e tenta concluir a Caixa. Se o compromisso tiver sido cancelado, a repetição informa o impedimento e preserva seu estado.

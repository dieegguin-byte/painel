# Conferência automática na nuvem

Implementação do redirecionamento `AGENTE-NUVEM-REDIRECIONAMENTO-20260914-2204-001`.

## Comportamento

O próprio PostgreSQL do Supabase confere os serviços a cada cinco minutos. O navegador apenas lê os resultados; não dispara a varredura. A aba **Conferência** reúne as ocorrências e permite consultar os fatos de um serviço. O Painel mostra um resumo do funcionamento do monitor.

A análise continua no Classic pelo botão ChatGPT da ficha, que já existia. Não há chamada de modelo, chave de IA, chatbot novo, envio automático de mensagem ou escrita automática nos estados da empresa.

## Regra desta versão

**SERVICO_PRONTO v1:** `public.servicos.status = 'pronto'`.

Título: **Pronto — entrega ainda não registrada no status**.

É uma situação informativa. Não significa atraso, não define prazo e não afirma que a entrega física não aconteceu. Só identifica que o estado oficial permanece `pronto`.

Fontes: Mapa da Operação Bahia V3, seção 6 (progressão: pronto não equivale a entregue); pedido do Classic identificado acima; estado estruturado já introduzido no app pelo commit `e8146aea48bb98848cc03f7ecfd5947bd073a1bd`.

Esta versão cobre uma classe. Não interpreta texto livre, materiais, financeiro ou todas as regras de agenda. Campos ausentes não viram erros ou obrigações por inferência.

## Objetos

- `private.conferencia_executar()`: função interna, `SECURITY INVOKER`, executável somente por `postgres`; SQL estático.
- `public.conferencia_ocorrencias`: projeção técnica, chave única `(regra, servico_id)`. Não contém tarefas, responsáveis, estados de negócio ou cópias de nomes. Sem vínculo que bloqueie a exclusão legítima de um serviço.
- `public.conferencia_estado`: uma linha com horário da última conclusão, contagem técnica e número de execuções.
- `public.conferencia_monitor()`: RPC de leitura que cruza a projeção com o serviço atual e respeita RLS. Uma ocorrência deixa de aparecer quando o status atual sai de `pronto`, mesmo antes da próxima varredura.
- `public.conferencia_consultar_servico(uuid)`: leitura sob demanda do serviço e de até 100 compromissos planejados diretamente vinculados. Não executa o monitor. Sua lista não interpreta remarcações e pode diferir da agenda operacional do app.
- Job `bahia-conferencia-pronto-v1`: `*/5 * * * *`, chamando o worker interno.

O comando do job é exatamente `set statement_timeout = '10s'; select private.conferencia_executar();`. O limite é definido antes da chamada do worker e vale somente para a sessão desse job. A configuração declarada dentro da função não basta para limitar uma chamada SQL direta: o cron utiliza a conexão PostgreSQL, enquanto RPCs do PostgREST aplicam as configurações antes da execução. Fontes: [explicação do PostgreSQL](https://www.postgresql.org/message-id/114105.1718809113@sss.pgh.pa.us), [implementação do pg_cron 1.6.4](https://github.com/citusdata/pg_cron/blob/v1.6.4/src/pg_cron.c) e [configurações de função no PostgREST](https://docs.postgrest.org/en/v12/references/transactions.html#function-settings).

## Integridade e acesso

Os registros de negócio são somente lidos. O worker atualiza exclusivamente as duas tabelas técnicas, na mesma transação, com bloqueio consultivo contra execuções simultâneas. Repetir uma leitura preserva a primeira detecção do período e não cria duplicatas. Sair da condição encerra somente a ocorrência técnica; voltar à condição reabre a mesma chave.

Falha em qualquer etapa reverte a varredura e não avança a última conclusão. A interface distingue execução ausente, leitura parcial, erro, falta de conexão e última execução antiga. Quinze minutos sem conclusão é um limite técnico de saúde do monitor, não uma regra operacional da empresa.

As tabelas têm RLS e somente SELECT para o papel autenticado. A política exige `usuario_autorizado()`; a de ocorrências exige também um serviço visível pelas permissões da fonte. As RPCs são `SECURITY INVOKER` e verificam autorização. `anon` não executa as RPCs e nenhum papel público executa o worker. Não há service role no cliente.

## Implantação e reversão

Testes reproduzíveis: `pnpm install --frozen-lockfile` e `pnpm test:monitor`. A suíte aplica a migração final em PGlite 0.5.8 (PostgreSQL 18.3) e verifica 27 cenários de integridade, autorização, falhas e consultas. Ela não simula pg_cron, PostgREST ou concorrência entre conexões; esses pontos dependem da verificação de implantação. O banco de produção usa PostgreSQL 17.6.

Regressão da tela e compilação completa: definir `BAHIA_BABEL_PATH` para uma instalação local de `@babel/standalone` e executar `node --test tests/pronto-producao.test.cjs`. Essa suíte acrescenta cinco verificações de prontidão e compilação.

1. Executar os testes locais contra PostgreSQL/PGlite e compilar `nova.html`.
2. Aplicar `migracoes/20260915015739_conferencia_monitor_pronto.sql`: objetos técnicos e leituras, sem agendamento.
3. Publicar o código atual da interface, após comparar novamente com o remoto.
4. Aplicar `migracoes/20260915015743_conferencia_monitor_agendamento.sql`.
5. Confirmar execução automática em `cron.job_run_details`, conferir horário/projeção e usar a interface com sessão real.

O retorno técnico da entrega registra os commits, resultados e se houve deploy. Este arquivo descreve o código e não é, por si só, prova de implantação.

Para interromper o monitor, executar `migracoes/rollback/conferencia_monitor.sql`. Ele pausa somente o job de nome e comando conhecidos, mantendo evidências técnicas e os demais jobs. A interface passa a indicar execução antiga após o limite técnico; para reversão completa da interface, reverter somente o commit dessa interface. Não é necessário apagar tabelas ou histórico.

## Custos e limites

Reutiliza o banco e o pg_cron existentes. A cada cinco minutos são até 288 execuções por dia. Não cria Edge Function, projeto ou assinatura, nem consome tokens de LLM.

Na verificação desta implementação, a organização estava no plano Free e o banco tinha aproximadamente 20 MB. Custo incremental esperado: zero enquanto o uso continuar nas quotas atuais; isso não é garantia de preço ou disponibilidade. O plano Free possui limites e pode pausar por inatividade. Fontes: [Cron](https://supabase.com/docs/guides/cron), [operação dos jobs](https://supabase.com/docs/guides/cron/quickstart) e [preços/quotas](https://supabase.com/pricing).

O monitor observa o estado a cada varredura; uma mudança que começa e termina entre duas varreduras pode não ser registrada. Ele não substitui o histórico oficial do serviço. A RPC do monitor informa o total real e limita a lista a 500; uma lista parcial não é apresentada como conferência completa.

## Histórico do piloto

O piloto anterior, com explicação opcional por IA, foi preservado no commit `8226680` e nos anexos enviados ao Drive. Seu código experimental e seus testes específicos foram retirados da versão ativa. A leitura passou a usar a API de banco com a sessão/RLS existentes.

## Pausa em 15/09/2026

Decisão do Diego, depois da análise do Claude. A regra SERVICO_PRONTO v1 lista exatamente os serviços com `status = 'pronto'`, que o card **Prontos para entregar** do Painel já mostra a partir da mesma fonte. Até existir uma regra que o app não consiga mostrar sozinho (por exemplo, pronto há vários dias sem entrega), o monitor não acrescenta informação e ocupava o topo do Painel e uma aba própria.

- Job `bahia-conferencia-pronto-v1` pausado com o script de rollback `migracoes/rollback/conferencia_monitor.sql` (somente `active = false`).
- Tabelas, RPCs, histórico técnico e `public.engenharia_itens` preservados.
- No `nova.html`: saíram a leitura periódica (`useConferenciaMonitor`), a aba **Conferência**, o resumo do Painel e o botão da ficha. Os componentes continuam no arquivo; o comentário junto de `monitorConferencia` diz o que devolver para reativar.
- O **Cronograma técnico** saiu do app junto com a aba: acompanhamento de engenharia fica no Drive e na tabela `engenharia_itens`, fora da tela da oficina.

Para reativar: aplicar de novo `migracoes/20260915015743_conferencia_monitor_agendamento.sql` e desfazer o commit da interface.

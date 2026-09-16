> **SUPERADO EM 16/09/2026 — ARQUITETURA OPERACIONAL**  
> Este arquivo permanece como histórico de produto, não como contrato operacional vigente. Na Operação Bahia, as regras atuais vêm da Biblioteca canônica (Bootstrap → MAPA_OPERACAO_BAHIA → Skill de domínio); Supabase/app guarda fatos vivos e public.agenda é a agenda oficial; Google Calendar está desativado; Claude/Engenharia é o executor técnico padrão e Codex só entra por pedido explícito de Diego. Guia/caixa/documentação antiga do app não substituem os canônicos.

# Cronograma técnico do Codex

## Onde aparece

Na aba **Conferência**, junto do contexto técnico. O monitor SERVICO_PRONTO v1 continua independente. O cronograma não cria nem modifica compromissos de clientes.

Datas aprovadas: [recado do cronograma](https://docs.google.com/document/d/1b9IToJ9HWvL9qHEvvh1Pv4ts715i3xhq91mvIdYm8zE/edit) e [plano de encerramento](https://docs.google.com/document/d/1I1nS3sD1YwVp6BbXwOV4h5ZRwWC3vL09rgtSeczA9qM/edit).

O intervalo do plano continua até 30/09/2026. A autorização canônica de executor Codex até 02/10/2026 não altera automaticamente esse cronograma aprovado.

## Fontes e atualização

- As datas de planejamento ficam no código e a fase é calculada no fuso America/Sao_Paulo.
- Os estados são registros de public.engenharia_itens no Supabase.
- O app consulta a tabela. Não interpreta arquivos do Drive, não recebe chave privilegiada e não oferece comandos para alterar estados.
- A consulta ocorre ao abrir a área, solicitar atualização ou retornar à aba/conexão. A fase de calendário pode atualizar sem escrever no banco.
- Drive permanece como recado, retorno e evidência. Não substitui os registros técnicos estruturados.
- A passagem do tempo, um commit ou um deploy não conclui um item.

## Manutenção por engenharia / Classic

O escritor autorizado usa a conexão administrativa existente do Supabase. Antes de atualizar, consulta o item pelo item_id e lê a evidência pertinente. Não criar um item duplicado para cada conversa.

Campos: item_id, descricao, prioridade, fase_id, criado_em, enviado_em, estado, recado_url, retorno_url, commit_hash, deploy_url, readback_tecnico_em, validacao_classic_em, validacao_classic_url, motivo_bloqueio e atualizado_em.

Prioridade ausente continua ausente; não inferir prioridade comercial. Fases admitidas: monitor, financeiro, prazos, materiais e handoff. Uma fase ausente não significa concluída.

Estados: a_fazer, enviado_codex, em_execucao, retorno_recebido, aguardando_validacao_classic, concluido, bloqueado e decisao_negocio_pendente.

O banco exige:
- retorno_url para retorno_recebido, aguardando_validacao_classic e concluido;
- readback_tecnico_em para aguardando_validacao_classic e concluido;
- validacao_classic_em e validacao_classic_url para concluido;
- motivo_bloqueio para bloqueado e decisao_negocio_pendente.

Após a entrega técnica, registrar retorno e readback e colocar **aguardando_validacao_classic**. Somente o Classic, após conferir o efeito e registrar sua evidência, deve autorizar **concluido**. Codex não assina a validação do Classic.

Ao atualizar, incluir atualizado_em = now() e condicionar ao estado/atualizado_em lidos para detectar concorrência. Fazer SELECT de readback antes de afirmar a atualização. A evidência deve sustentar o estado; preencher campos só para passar nas constraints não é validação.

## Acesso e limites

A tabela usa RLS com o mesmo public.usuario_autorizado() já usado pela Conferência. authenticated autorizado recebe somente SELECT. anon não recebe acesso. Escrita fica no backend privilegiado existente.

Falha de conexão, tabela indisponível ou consulta incompleta deve mostrar indisponibilidade, nunca zero pendências. O app mostra o horário da leitura. Os dados técnicos não são uma fila operacional.

Nenhum cron, regra de monitor, função de negócio ou assinatura realtime é criado pelo cronograma.

## Testes

No diretório do repositório, instalar as dependências com `pnpm install --frozen-lockfile`. O teste da interface também precisa do arquivo oficial Babel Standalone 7 (o mesmo compilador usado pelo app), informado por caminho absoluto em `BAHIA_BABEL_PATH`:

~~~powershell
$env:BAHIA_BABEL_PATH = 'C:\caminho\para\babel-standalone-7.min.cjs'
node --test tests/engenharia-itens.test.mjs
node --test tests/cronograma-tecnico-ui.test.cjs
~~~

Os testes SQL usam PostgreSQL em memória (PGlite), sem conexão com produção. Os testes da interface cobrem fronteiras de datas e apresentação; a conferência no navegador completa a verificação visual.

## Rollback

1. Retirar o componente CronogramaTecnico da aba Conferência, preservando a alteração de Produção concluída se ela continuar desejada.
2. Se necessário, executar migracoes/rollback/engenharia_itens.sql para revogar a leitura do app.
3. Preservar tabela, itens e evidências. Não executar DROP nem excluir os registros para desativar a interface.
4. Para reativar, reaplicar migracoes/20260915153026_engenharia_itens_cronograma.sql e restaurar o componente.
5. Conferir acesso, estado exibido e monitor SERVICO_PRONTO v1 após qualquer reversão.

O rollback SQL foi testado em memória, incluindo repetição e reaplicação. O cronograma não altera o agendamento do monitor.

# Piloto de consulta de um serviço

Código local para uma Edge Function Supabase. Este diretório, por si só, não publica nem agenda a função.

## Contrato

`POST` autenticado com `Content-Type: application/json`:

```json
{ "servico_id": "UUID do serviço", "pergunta": "Pergunta opcional de até 500 caracteres" }
```

Retorna `ok`, `modo`, `consultado_em`, `servico`, `compromissos`, `resumo`, `observacoes` e `limites`.
`modo: "regras"` apresenta dados registrados, sem geração por IA. Uma pergunta enviada neste modo é explicitamente identificada como não interpretada.

Os dados do serviço incluem identificação, título, status, próxima ação, prazo, profissional, responsável, loja, data de entrega do material e campos selecionados de materiais. Os compromissos incluem identificação, título, data, hora e status.

Falhas retornam `{ "ok": false, "erro": { "codigo": "...", "mensagem": "..." } }` e HTTP 4xx/5xx. Uma falha na agenda impede uma resposta de sucesso parcial. Não há retorno de mensagens internas do provedor.

## Leitura e autenticação

1. Valida o token real com `GET /auth/v1/user`.
2. Verifica `GET /rest/v1/rpc/usuario_autorizado`, função SQL `STABLE` existente que consulta a lista de usuários autorizados.
3. Consulta `servicos` por um único UUID, com seleção explícita de campos.
4. Consulta `agenda` pelo mesmo `servico_id` e `status=planejado`.

Todas as requisições ao Supabase usam `GET`, a chave pública e o JWT recebido. O piloto não usa service role, não acessa financeiro/contatos/histórico/caixa e não grava registros. Não cria agendamentos, tabelas ou filas.

**Limite funcional:** o app também considera remarcações em `caixa_entrada` para ocultar compromissos. Este piloto não consulta esse fluxo; apresenta apenas registros diretamente vinculados em `agenda`, não uma validação da agenda operacional. Ausência de informação não é classificada como erro, atraso ou nova obrigação.

## Configuração do ambiente de execução

- `SUPABASE_URL`: URL HTTPS da API do projeto.
- `SUPABASE_PUBLISHABLE_KEY` ou `SUPABASE_ANON_KEY`: chave pública. Chaves secretas/service role são recusadas.
- `AGENTE_ALLOWED_ORIGINS`: origens exatas separadas por vírgula, por exemplo `https://seu-app.example`. Sem curingas; configuração vazia falha de modo fechado.
- `AGENTE_IA_ENABLED=true`: habilita a explicação opcional. Desabilitada por padrão.
- `OPENAI_API_KEY` e `OPENAI_MODEL`: chave secreta e modelo escolhidos no ambiente do servidor. Nenhum modelo é presumido; ausência de configuração preserva os registros com aviso de IA indisponível.

Somente uma requisição com `pergunta` não vazia tenta usar IA, depois de confirmar sessão, autorização e leituras completas. Não existe loop nem agendamento. A chamada usa Responses API com `store:false`, Structured Outputs, até 2.500 tokens de saída, timeout de 20s e nenhuma ferramenta de escrita. Campos excessivamente longos bloqueiam a explicação, sem cortar ressalvas. A chave, IDs internos, contatos e o relatório completo não são enviados no corpo ao modelo; somente os campos explicitamente selecionados do serviço/agenda e a pergunta. Os campos textuais podem conter informação que o operador escreveu, portanto o envio real requer a conexão configurada para esse uso.

A explicação é uma interpretação separada dos registros. Recusa, erro, timeout, fonte inválida e resposta incompleta deixam `modo: "regras"` e um aviso explícito. Este piloto ainda não foi validado com uma chave/modelo reais.

Não coloque segredos neste diretório. CORS não substitui a autenticação. Clientes sem `Origin` ainda precisam da sessão e da autorização.

O corpo é limitado a 8 KiB; a pergunta a 500 caracteres; cada leitura tem tempo máximo de 10 segundos; cada resposta upstream tem limite de 256 KiB. Mais de 100 compromissos gera erro explícito em vez de uma lista truncada.

## Testes locais

```sh
node --test tests/agente-conferencia*.test.mjs
```

Os testes usam respostas simuladas e não consultam nem modificam produção.

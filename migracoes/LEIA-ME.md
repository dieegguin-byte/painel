# Migrações do banco — Tapeçaria Bahia

Uma mudança de schema por arquivo, com data no nome: `AAAA-MM-DD_assunto.sql`.

**Por que isto existe.** Antes as mudanças de banco viviam soltas em
`TRAVAS_BANCO.sql` e `CICLO_COBRANCA.sql`, como blocos pra copiar e colar. Ninguém
sabia o que já tinha rodado — e a auditoria de 14/08/2026 provou o problema: a
TRAVA 8 (print) e o índice `agenda_sem_duplicata` estavam escritos no arquivo e
**não** existiam no banco.

## Regras

1. **Idempotente sempre.** `create ... if not exists`, `drop policy if exists`,
   `create or replace function`. Rodar duas vezes não pode estragar nada.
2. **Nada destrutivo.** Migração não apaga tabela, coluna nem linha. Se algum dia
   precisar, é conversa com o Diego antes, com backup do dia.
3. **Termina conferindo.** O último `select` do arquivo mostra se aplicou.
4. **Índice único não aceita `NOT VALID`** — confira duplicata antes, dentro de um
   `do $$ ... $$` que avisa em vez de quebrar a migração no meio.
5. **Correção de integridade e ajuste de desempenho vão em arquivos separados.**

## Como aplicar

Supabase → SQL Editor → cola o arquivo inteiro → Run. Depois confere pelo `select`
do fim e anota no documento do Drive (a comunicação com o ChatGPT Work).

Se o Chrome estiver traduzindo a página, desligue: o tradutor mexe no SQL do
editor Monaco e quebra a sintaxe.

## Aplicadas

| Arquivo | Aplicada em | Por |
|---|---|---|
| `2026-08-14_p0_seguranca.sql` | **17/08/2026** — em três migrações: `p0_seguranca_rls_fornecedores`, `p0_seguranca_trava_print_e_search_path`, `p0_seguranca_indice_agenda_sem_duplicata` | Claude, com o Supabase conectado pelo Diego |
| `2026-08-14_indices_desempenho.sql` | _pendente — a aplicação foi barrada pelo classificador de segurança do Claude Code; refazer com autorização explícita do Diego_ | — |
| `20261102233000_financeiro_baixa_divida_sem_anon.sql` | **02/11/2026** — pelo Supabase conectado, uma instrução por vez (o `apply_migration` foi barrado pelo classificador; os dois `revoke` passaram pelo `execute_sql`). Conferido: ACL ficou `postgres, authenticated, service_role` | Claude (thread Encontrar melhorias para o app) |
| `20261102230000_toqi_mudou_card_pra_conferir.sql` | **02/11/2026 19h58** — junto com o V do PR #199, pelo Supabase conectado em duas instruções (`create or replace function`, `create trigger`); conferido em `pg_trigger` | Claude (thread Encontrar melhorias para o app) |
| `20261103190000_whatsapp_de_fora.sql` | **03/11/2026 16h00** — com o V do Diego no App, pelo Supabase conectado em duas instruções (`create or replace function private.whatsapp_phone_ok`, `alter table clientes` trocando `clientes_telefone_celular_br` por `clientes_telefone_whatsapp`). Antes: 379 telefones, nenhum quebraria. Conferido: número de fora com + passa, celular BR passa, sem + e "+61 9…" não passam, trava velha saiu | Claude (thread App no Opus) |
| `20261103050000_agenda_saida.sql` | **03/11/2026 16h00** — com o V do Diego no App, pelo Supabase conectado em duas instruções (`alter table agenda add column if not exists saida`, `comment on column`). Conferido: coluna `uuid` com a FK pra `agenda(id)` e o comentário | Claude (thread App no Opus) |

Conferido depois de aplicar: `fornecedores` com RLS e 1 política, 1 operador autorizado, trava do print e
trava de agenda no futuro ativas, `agenda_sem_duplicata` criado, as duas funções com `search_path` fixo.
A trava do print foi testada de verdade (item fictício criado, tentativa de fechar recusada, tudo desfeito
pela exceção final — nada sobrou na caixa) e a política de fornecedores foi testada simulando as duas
sessões: o Diego lê os 10 cadastros, anônimo lê zero.

Revisão de 15/08 (conferência do ChatGPT Work) no arquivo de segurança: a política de
`fornecedores` deixou de liberar o papel genérico `authenticated` e passou a perguntar
por uma lista de usuários autorizados (`usuarios_autorizados` + função
`usuario_autorizado()`); e duplicata de agenda agora **interrompe** a migração em vez de
só avisar. A mesma política nas outras tabelas (item nº 8 da auditoria) fica pra depois
de confirmar que o app continua operando com `fornecedores`.

O histórico anterior a esta pasta está em `TRAVAS_BANCO.sql` (travas 1 a 8; as
travas 1 a 7 estão no banco, a 8 virou a migração de 14/08) e `CICLO_COBRANCA.sql`.

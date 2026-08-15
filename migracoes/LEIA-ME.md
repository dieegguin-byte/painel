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
| `2026-08-14_p0_seguranca.sql` | _pendente — precisa da sessão do Diego no painel do Supabase_ | — |
| `2026-08-14_indices_desempenho.sql` | _pendente_ | — |

O histórico anterior a esta pasta está em `TRAVAS_BANCO.sql` (travas 1 a 8; as
travas 1 a 7 estão no banco, a 8 virou a migração de 14/08) e `CICLO_COBRANCA.sql`.

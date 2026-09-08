-- ENCAIXE DE ROTA — novo domínio para avisos_operacionais (item ENCAIXES-ROTA-20260908)
--
-- POR QUE: serviço vivo que precisa de uma ida cuja viagem isolada não se paga fica esperando uma rota
-- compatível aparecer. Ele não tem data — e o app só mostrava agenda com data, então o caso sumia da
-- tela que o Diego usa. O bloco "Encaixes de rota" do Painel lê ESTE domínio.
--
-- POR QUE UM DOMÍNIO, E NÃO UMA COLUNA NOVA: `dominio` já é a classificação estruturada da tabela.
-- Um valor a mais é a menor extensão possível, e não toca em nenhum aviso existente. A alternativa
-- (procurar as palavras "encaixe"/"rota" dentro do texto de `aviso`) seria heurística frágil: quem
-- escreve o aviso é o Classic, em português livre, e a frase muda toda vez.
--
-- ⚠ EU TINHA ASSUMIDO QUE `dominio` ERA CAMPO LIVRE. Não é — existe
-- `avisos_operacionais_dominio_check` com uma lista fechada de 5 valores, e o UPDATE quebrou nela.
-- A trava está certa; o que faltava era o valor. Esta migração amplia a lista, não a remove.

-- 1. SCHEMA — amplia o vocabulário permitido. Idempotente: dropa e recria.
alter table public.avisos_operacionais
  drop constraint if exists avisos_operacionais_dominio_check;

alter table public.avisos_operacionais
  add constraint avisos_operacionais_dominio_check
  check (dominio = any (array['agenda', 'financeiro', 'producao', 'compras', 'geral', 'encaixe_rota']));

-- 2. CARIMBO DOS DOIS CASOS VIVOS medidos em 08/09/2026, varrendo os 11 avisos ativos — não só o caso
--    que o recado relatou:
--      c63dbc26  Maria / Seu Santana — Sudoeste/DF, visita técnica (o caso do recado)
--      df214919  Elizabeth — Valparaíso, entrega do encosto (mesma forma, não estava no recado)
--    FORA de propósito: Thelícia (45de1fc3) também tem agenda cancelada, mas é janela de horário
--    ("só recebe 12–13h ou depois das 18h") e já tem compromisso vivo. Não é encaixe.
--    O guard `dominio = 'agenda'` mantém idempotente e impede reescrever um domínio ajustado à mão.
update public.avisos_operacionais
   set dominio = 'encaixe_rota'
 where id in ('c63dbc26-9a05-4166-beb7-6e6cb58e8a3a', 'df214919-b61c-4844-80b8-c6a6b21c5299')
   and dominio = 'agenda';

-- 3. CONFERE — tem que voltar 2 linhas em 'encaixe_rota', e a lista do check com 6 valores.
select 'avisos' as o, dominio, count(*)::text as qtd
  from public.avisos_operacionais where ativo group by dominio
union all
select 'check', conname, pg_get_constraintdef(oid)
  from pg_constraint where conname = 'avisos_operacionais_dominio_check';

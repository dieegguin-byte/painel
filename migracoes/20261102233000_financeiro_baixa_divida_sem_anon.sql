-- FINANCEIRO_BAIXA_DIVIDA SEM O PAPEL ANON (02/11/2026, revisão do app, item 9 reduzido; Diego: "Então aplique").
-- O advisor de segurança do Supabase apontava que public.financeiro_baixa_divida() (security definer) podia ser
-- executada por PUBLIC e por anon (quem não entrou). Ela é função de GATILHO da tabela financeiro — só roda quando a
-- tabela muda, nunca por chamada direta — então tirar o EXECUTE de anon e de PUBLIC não muda nada no app e fecha o
-- apontamento. authenticated, service_role e postgres continuam como estão. Idempotente: revogar duas vezes é inócuo.
--
-- O resto do item 9 ficou de fora de propósito: usuario_autorizado(), usuario_mural(), mural_toqi_cota_ok() e
-- push_segurar_lembrete() PRECISAM do EXECUTE (são as políticas RLS e o push); as sobras de teste (push_acao_teste_tmp
-- e o schema teste_seguranca) só saem com a palavra do Diego, porque é DROP.

revoke execute on function public.financeiro_baixa_divida() from public;
revoke execute on function public.financeiro_baixa_divida() from anon;

-- Confere: anon e PUBLIC fora, authenticated e service_role dentro.
select p.proname, p.proacl::text as acl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'financeiro_baixa_divida';

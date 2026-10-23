-- CARTÃO DE ENVIO: QUANDO A ZAPIA REALMENTE MANDOU (Manu, 23/10/2026, Suzany: "já aplicada pela Manu" foi lido pela
-- Zapia como já enviado e o texto não saiu às 14h20). A Manu grava enviado_em quando o RETORNO da Zapia mostra
-- RECADO ENVIADO (hora ou id da mensagem). Até lá o cartão diz "ainda NÃO enviada, esperando a Zapia enviar".
alter table public.duvidas_agente add column if not exists enviado_em timestamptz;

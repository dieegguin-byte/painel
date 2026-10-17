-- CÓDIGO DE PAGAMENTO NA CONTA (Diego, 17/10/2026: "coisa como essa da ADARCO já tem dados para pagamento, já tem
-- que deixar tudo fácil pra mim copiar nos dois cards que falam de dinheiro e pagamento"). Linha digitável do
-- boleto, Pix copia e cola ou chave Pix da cobrança. O app mostra com botão Copiar no card "Pagar a ..." da agenda
-- (ligado por agenda.financeiro_id) e na conta do card Dinheiro / A pagar. Quem preenche é a Manu.
alter table public.financeiro add column if not exists codigo_pagamento text;

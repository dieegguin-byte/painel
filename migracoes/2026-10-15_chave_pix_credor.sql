-- 15/10/2026. Diego: "era para abrir o WhatsApp do contato de quem eu tenho que pagar (no caso o Alex da
-- Afibracom) e a chave Pix também com cópia e cola". O card de pagamento abria o WhatsApp da cliente e não
-- tinha onde guardar a chave Pix de quem recebe. Coluna nova em fornecedores e profissionais; o app mostra
-- a chave com botão de copiar no card em que ele deve alguém. A chave só entra com dado gravado: a do
-- Marlom Júnior já estava na observação dele (08/09/2026: favorecida Lúcia Tiago Souza, Nu Pagamentos).
-- Marcão: a observação fala só de "chave com final 8607" — não é a chave inteira, fica em branco pra Manu confirmar.
alter table public.fornecedores add column if not exists chave_pix text;
alter table public.profissionais add column if not exists chave_pix text;
comment on column public.fornecedores.chave_pix is 'Chave Pix de quem recebe (CPF/CNPJ, e-mail, telefone ou aleatória). Só dado confirmado, nunca adivinhado.';
comment on column public.profissionais.chave_pix is 'Chave Pix do profissional (ou da conta que ele indicou). Só dado confirmado, nunca adivinhado.';
update public.profissionais set chave_pix = 'lucia1983souza@gmail.com' where nome = 'Marlom Júnior' and chave_pix is null;

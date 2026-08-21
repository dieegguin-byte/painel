-- Dados 100% sinteticos para DEV/STAGING. Nao copiar PII de producao.
-- IMPORTANTE: usuarios Auth NAO sao criados por SQL.
-- Crie contas de teste pela API oficial Supabase Auth e depois inclua o user_id
-- em public.usuarios_autorizados. Isso evita fixtures auth.users incompletas.

insert into public.config (id,pin_hash,ajustes) values (1,null,'{}'::jsonb) on conflict (id) do nothing;
insert into public.fornecedores (id,nome,cidade,produtos,dias_entrega) values ('33333333-3333-4333-8333-333333333333','Fornecedor Teste','Luziânia','tecido, espuma','terça e quinta') on conflict (id) do nothing;
insert into public.clientes (id,nome,telefone,cidade,endereco,obs) values
('11111111-1111-4111-8111-111111111111','Cliente Teste A','5561996123456','Luziânia','Endereço sintético 1','fixture V4'),
('22222222-2222-4222-8222-222222222222','Cliente Teste B','5562997123456','Valparaíso','Endereço sintético 2','fixture V4') on conflict (id) do nothing;
insert into public.servicos (id,cliente_id,titulo,status,prioridade,valor_orcamento,prazo,proxima_acao,materiais_necessarios,tracking_ref,origem_plataforma,origem_campanha_id,utm_source) values
('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','Reforma sintética A','orcamento','alta',3200,'2026-12-31','follow-up','[{"item":"tecido","quantidade":12}]'::jsonb,'BH-TEST01','google_ads','camp-test-1','google'),
('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222','Reforma sintética B','producao','media',2500,'2026-12-15','acompanhar produção','[{"item":"espuma","quantidade":5}]'::jsonb,null,null,null,null) on conflict (id) do nothing;
insert into public.agenda (id,servico_id,titulo,data,hora,local,status,cidade,tipo) values ('66666666-6666-4666-8666-666666666666','44444444-4444-4444-8444-444444444444','Visita de teste','2026-12-01','14:30','Endereço sintético 1','planejado','Luziânia','presencial') on conflict (id) do nothing;
insert into public.financeiro (id,tipo,escopo,categoria,valor,descricao,status,data,servico_id) values ('77777777-7777-4777-8777-777777777777','entrada','empresa','Serviço',1000,'Entrada sintética recebida','pago','2026-11-01','44444444-4444-4444-8444-444444444444') on conflict (id) do nothing;
insert into public.financeiro (id,tipo,escopo,categoria,valor,descricao,status,data,fornecedor_id,servico_id) values ('88888888-8888-4888-8888-888888888888','saida','empresa','Material',300,'Compra sintética','pago','2026-11-02','33333333-3333-4333-8333-333333333333','55555555-5555-4555-8555-555555555555') on conflict (id) do nothing;
insert into public.dividas (id,credor,fornecedor_id,valor_original,valor_pago,descricao,status) values ('99999999-9999-4999-8999-999999999999','Fornecedor Teste','33333333-3333-4333-8333-333333333333',500,100,'Dívida sintética','aberta') on conflict (id) do nothing;
insert into public.fotos (id,servico_id,cliente_id,url,tipo) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','https://example.invalid/mock.jpg','orcamento') on conflict (id) do nothing;
insert into public.estoque (id,item,quantidade,unidade,minimo,comprar,obs) values ('ffffffff-ffff-4fff-8fff-ffffffffffff','TNT teste',10,'m',5,false,'fixture V4') on conflict (id) do nothing;
insert into public.rotinas (id,titulo,intervalo_dias,hora,observacao,ativo) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Rotina sintética',1,'06:00','somente staging',true) on conflict (id) do nothing;
insert into public.guia_ia (id,secao,titulo,conteudo) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','regras','Regra sintética','Nunca usar este conteúdo como regra de produção.') on conflict (id) do nothing;
insert into public.historico (id,o_que,por,detalhe) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','seed_v4','diego','registro sintético') on conflict (id) do nothing;
insert into public.marketing_atribuicoes (id,tracking_ref,gclid,utm_source,utm_medium,utm_campaign,campaign_id,landing_page) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','BH-TEST01','gclid-test','google','cpc','campanha-teste','camp-test-1','https://example.invalid/v4') on conflict (id) do nothing;
insert into public.caixa_entrada (id,texto,processado,status,conversa) values ('12121212-1212-4212-8212-121212121212','Evento legado sintético',false,'novo','[]'::jsonb) on conflict (id) do nothing;

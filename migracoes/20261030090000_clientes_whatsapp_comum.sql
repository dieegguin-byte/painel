-- WHATSAPP COMUM POR CLIENTE (30/10/2026, Diego pela Toqi no Mural, 30/10 00h25: "autoriza corrigir a
-- exposição de dados de clientes no código público. Não publicar sem novo Sim do Diego").
-- A exceção "a conversa deste cliente abre no WhatsApp comum, não no Business" morava no nova.html como
-- lista de telefones, num repositório PÚBLICO. Agora é uma coluna da ficha, atrás do mesmo RLS de clientes.
-- O app já lê clientes com select("*"), então a consulta não muda.
-- Pôr um cliente na exceção daqui pra frente (sem PR): update public.clientes set whatsapp_comum = true where id = '<id>'
alter table public.clientes add column if not exists whatsapp_comum boolean not null default false;
comment on column public.clientes.whatsapp_comum is 'true = o botão de WhatsApp deste cliente abre o WhatsApp comum do Diego, não o Business. Só com pedido do Diego para aquele cliente.';
-- Os seis clientes que estavam na lista do código (pedidos do Diego de 08/09 a 21/10/2026), por id.
update public.clientes set whatsapp_comum = true
 where id in ('bdaedbe3-fdc3-4fd9-bf5b-6590294d19fe', 'fc855cc1-6103-4781-94c4-d1b600e71727', 'e569f370-c043-4dbe-bde1-8fcc917032a9',
              '179f85af-9308-4fad-812b-bf3eff25b08d', '27dd4256-f00a-4103-a64a-0cc0cb15fee9', '431d0284-f359-4a2f-bf8a-c2486b420c8b')
   and not whatsapp_comum;
-- Confere: tem que voltar 6.
select count(*) as clientes_whatsapp_comum from public.clientes where whatsapp_comum;

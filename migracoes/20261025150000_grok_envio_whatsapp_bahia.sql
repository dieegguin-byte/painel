-- ENVIO SEM ZAPIA E O GROK NO HISTÓRICO (pedido do Grok, 25/10/2026, confirmado pelo Diego: "Grok opera tudo agora,
-- Zapia só coleta, envio via WhatsApp Bahia + card"). Uma instrução por vez, nesta ordem.
--
-- canal_envio: por onde sai o texto aprovado no cartão de envio. whatsapp_bahia = o Grok manda pelo WhatsApp da
-- empresa, sem recado à Zapia. zapia_reserva = o caminho antigo, recado à Zapia. Vazio em cartão antigo: o app deduz
-- (opção "Grok manda" = whatsapp_bahia, Zapia citada = zapia_reserva).
alter table public.duvidas_agente add column if not exists canal_envio text;

-- texto_envio: o texto exato que vai pro cliente. O app monta o link wa.me já com ele.
alter table public.duvidas_agente add column if not exists texto_envio text;

alter table public.duvidas_agente add constraint duvidas_agente_canal_envio_check check (canal_envio is null or canal_envio in ('whatsapp_bahia', 'zapia_reserva'));

-- historico.por passa a aceitar 'grok', pra ficar claro no app quem fez cada escrita.
alter table public.historico drop constraint historico_por_check;

alter table public.historico add constraint historico_por_check check (por in ('diego', 'claude', 'grok'));

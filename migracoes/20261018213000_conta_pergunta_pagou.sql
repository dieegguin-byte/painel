-- "PAGOU?" ANTES DE DAR BAIXA (Diego, 18/10/2026). No sábado 17/10 o card "Pagar a ADARCO" foi marcado Feito pela
-- notificação e o gatilho agenda_baixa_financeiro deu o boleto de outubro (R$ 190,70) como pago, sem comprovante.
-- Agora o botão Feito da notificação num card ligado a conta ainda aberta (agenda.financeiro_id) não grava nada:
-- responde ok:false com `abrir`, e o service worker (sw.js v27) abre o app no card com a pergunta "Pagou? Sim /
-- Ainda não". Só o Sim, dentro do app, marca o card feito (e o gatilho baixa a conta). O resto do push_acao é o
-- mesmo de antes. Idempotente: create or replace.
create or replace function public.push_acao(p_recibo uuid, p_acao text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r public.push_recibos%rowtype;
  plano jsonb;
  linha record;
  ag public.agenda%rowtype;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  nova_hora time;
begin
  select * into r from push_recibos where recibo = p_recibo for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'recibo desconhecido'); end if;
  if r.acionado_em is not null then return jsonb_build_object('ok', true, 'motivo', 'ja respondido', 'resposta', r.acao); end if;
  plano := r.acoes -> p_acao;
  if plano is null then return jsonb_build_object('ok', false, 'motivo', 'botao sem plano'); end if;

  if plano ->> 'tabela' = 'duvidas_agente' then
    update duvidas_agente
       set status = 'respondida', resposta = plano ->> 'resposta', respondido_em = now()
     where id = (plano ->> 'id')::uuid and status = 'aberta'
     returning id, pergunta, cliente_id into linha;
    if not found then
      update push_recibos set acionado_em = now(), acao = p_acao where recibo = p_recibo;
      return jsonb_build_object('ok', true, 'motivo', 'cartao ja fechado no app');
    end if;
    insert into historico (o_que, por, detalhe)
    values ('Respondeu ao Claude pela notificação: ' || left(linha.pergunta, 80), 'diego',
            (plano ->> 'resposta') || coalesce(' · cliente ' || linha.cliente_id::text, ''));

  elsif plano ->> 'tabela' = 'agenda' then
    select * into ag from agenda where id = (plano ->> 'id')::uuid for update;
    if not found or ag.status <> 'planejado' then
      update push_recibos set acionado_em = now(), acao = p_acao where recibo = p_recibo;
      return jsonb_build_object('ok', true, 'motivo', 'card ja resolvido no app');
    end if;
    -- Card de conta ainda aberta: não dá baixa por aqui. O recibo fica sem acionar e a notificação na barra.
    if plano ->> 'resposta' = 'feito' and ag.financeiro_id is not null
       and exists (select 1 from financeiro f where f.id = ag.financeiro_id and f.status in ('a_pagar', 'a_receber')) then
      return jsonb_build_object('ok', false, 'motivo', 'conta pede confirmacao no app',
                                'abrir', './nova.html?ir=card&id=' || ag.id::text || '&pagou=1');
    end if;
    if plano ->> 'resposta' = 'feito' then
      insert into agenda_recados (agenda_id, acao, texto)
      values (ag.id, 'feito', 'Feito pela notificação' || case when ag.data > hoje then ' [marcado para ' || ag.data || coalesce(' ' || to_char(ag.hora, 'HH24:MI'), '') || ']' else '' end);
      update agenda set status = 'feito', data = least(ag.data, hoje), nota_claude_conferida = true where id = ag.id;
      if ag.pessoal_id is not null then
        update pessoais set status = 'CONCLUIDO', concluido_em = now(), atualizado_em = now() where id = ag.pessoal_id and status = 'PENDENTE';
      end if;
      insert into historico (o_que, por, detalhe)
      values ('Feito pela notificação: ' || left(coalesce(ag.titulo, ''), 80), 'diego', 'agenda ' || ag.id::text);
    elsif plano ->> 'resposta' = 'adiar' then
      nova_hora := case when ag.hora >= time '23:00' then ag.hora else ag.hora + interval '1 hour' end;
      update agenda set hora = nova_hora where id = ag.id;
      insert into agenda_recados (agenda_id, acao, texto)
      values (ag.id, 'recado', 'Adiou 1 hora pela notificação (era ' || to_char(ag.hora, 'HH24:MI') || ', agora ' || to_char(nova_hora, 'HH24:MI') || ')');
      perform push_reservar(array['agenda:' || ag.id::text]);
      perform push_soltar(array['agenda-hora:' || ag.id::text]);
      insert into historico (o_que, por, detalhe)
      values ('Adiou 1h pela notificação: ' || left(coalesce(ag.titulo, ''), 80), 'diego',
              'agenda ' || ag.id::text || ' · antes: ' || to_char(ag.hora, 'HH24:MI') || ' → depois: ' || to_char(nova_hora, 'HH24:MI'));
    else
      return jsonb_build_object('ok', false, 'motivo', 'resposta sem tratamento');
    end if;

  elsif plano ->> 'tabela' = 'teste' then
    null;
  else
    return jsonb_build_object('ok', false, 'motivo', 'tabela sem tratamento');
  end if;

  update push_recibos set acionado_em = now(), acao = p_acao where recibo = p_recibo;
  return jsonb_build_object('ok', true, 'resposta', plano ->> 'resposta');
end;
$function$;

-- Confere: a função nova tem a pergunta.
select position('conta pede confirmacao' in pg_get_functiondef('public.push_acao(uuid,text)'::regprocedure)) > 0 as aplicada;

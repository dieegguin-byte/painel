-- O AVISO DO CELULAR TEM QUE SUMIR (Diego, 23/10/2026: "Eu tô com muito problema nessas notificações. Ela tem que
-- sumir. Não tá sumindo quando eu tô executando."). Revisão de ponta a ponta: em 24h saíram 302 avisos e 301 ficaram
-- sem nenhum toque; o mesmo card voltava de 5 em 5 minutos.
-- Uma instrução por vez, na ordem abaixo. Depois: deploy do push-enviar e merge do sw.js/nova.html.

-- 1. Deslizou o aviso pra fora da barra: o service worker (v28) carimba aqui. Conta como visto.
alter table public.push_recibos add column if not exists dispensado_em timestamptz;

-- 2. De qual card/rotina/conta é o aviso, e com que dia e hora ele saiu. É o que deixa o banco dizer "esse já não vale".
alter table public.push_recibos add column if not exists item jsonb;

-- 3. O recibo aceita o carimbo 'dispensado'.
CREATE OR REPLACE FUNCTION public.push_recibo_marcar(p_recibo uuid, p_campo text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_campo = 'recebido' then
    update push_recibos set recebido_em = coalesce(recebido_em, now()) where recibo = p_recibo;
  elsif p_campo = 'aberto' then
    update push_recibos set aberto_em = coalesce(aberto_em, now()) where recibo = p_recibo;
  elsif p_campo = 'dispensado' then
    -- Ele tirou o aviso da barra: viu e dispensou. O aviso insistente para (ver 'visto' no push_pendencias).
    update push_recibos set dispensado_em = coalesce(dispensado_em, now()) where recibo = p_recibo;
  else
    return false;
  end if;
  return found;
end;
$function$;

-- 4. Abrir recibo guardando o item do aviso.
CREATE OR REPLACE FUNCTION public.push_recibo_abrir(p_tag text, p_acoes jsonb, p_item jsonb)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into push_recibos (tag, acoes, item) values (p_tag, p_acoes, p_item) returning recibo;
$function$;

revoke all on function public.push_recibo_abrir(text, jsonb, jsonb) from public, anon, authenticated;

grant execute on function public.push_recibo_abrir(text, jsonb, jsonb) to service_role;

-- 5. push_pendencias:
--    'agenda' e 'agenda_na_hora' trazem a data do card (a chave do aviso passa a levar o dia: card que muda de dia ou
--    de hora não herda o "já avisado" do horário velho, e a repetição é contada por dia, não recomeça a cada remarcada).
--    'agenda' traz o cliente (o toque no lembrete de 60 min abre a ficha, como o da hora já fazia).
--    'visto' vale pro dia inteiro e conta também o aviso dispensado (deslizado pra fora da barra).
--    'rotinas_na_hora' só usa o adiada_ate se ele for de hoje (o de ontem dava "Agora 18:00" e "Adiada, era 07:00").
CREATE OR REPLACE FUNCTION public.push_pendencias()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with agora as (select (now() at time zone 'America/Sao_Paulo') as t),
     hoje  as (select (now() at time zone 'America/Sao_Paulo')::date as d),
     com_toque as (
       select r.agenda_id as id from agenda_recados r
       where r.processado_em is null and r.acao in ('remarcar', 'recado')
       union
       select a.id from agenda a
       where a.status = 'planejado' and exists (
         select 1 from caixa_entrada c
         where c.processado is not true
           and c.conversa @> jsonb_build_array(jsonb_build_object('meta', jsonb_build_object('origem', 'manu_resolve', 'agenda_id', a.id::text))))
     ),
     contas as (
       select f.id, f.descricao, f.categoria, f.escopo, f.valor, f.data, (f.data - hoje.d) as dias
       from financeiro f, hoje
       where f.status = 'a_pagar' and f.tipo = 'saida' and f.data is not null
         and coalesce(f.categoria, '') not in ('Vale', 'Mão de obra')
         and f.data <= hoje.d + 3
     )
select jsonb_build_object(
  'agora', (select t from agora),
  'hoje',  (select d from hoje),
  'agenda', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'titulo', coalesce(nullif(btrim(pe.titulo), ''), a.titulo), 'data', a.data, 'hora', to_char(a.hora,'HH24:MI'),
      'local', a.local, 'cidade', a.cidade, 'tipo', a.tipo, 'servico_id', a.servico_id,
      'cliente_id', coalesce(a.cliente_id, sv.cliente_id),
      'faltam', floor(extract(epoch from ((a.data + a.hora) - agora.t))/60)::int,
      'na_janela', ((a.data + a.hora) <= agora.t + interval '60 minutes')
    ) order by (a.data + a.hora))
    from agenda a
    left join pessoais pe on pe.id = a.pessoal_id
    left join servicos sv on sv.id = a.servico_id, agora
    where a.status = 'planejado' and a.hora is not null
      and (a.data + a.hora) >= agora.t
      and (a.data + a.hora) <= agora.t + interval '6 hours'
      and not (a.tipo is distinct from 'presencial' and exists (select 1 from com_toque ct where ct.id = a.id))
  ), '[]'::jsonb),
  'agenda_na_hora', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'titulo', coalesce(nullif(btrim(pe.titulo), ''), a.titulo), 'data', a.data, 'hora', to_char(a.hora,'HH24:MI'),
      'local', a.local, 'cidade', a.cidade, 'tipo', a.tipo, 'servico_id', a.servico_id,
      'cliente_id', coalesce(a.cliente_id, sv.cliente_id),
      'passaram', floor(extract(epoch from (agora.t - (a.data + a.hora)))/60)::int,
      'visto', exists (
        select 1 from push_recibos r, hoje
        where r.tag = 'agenda-' || a.id::text
          and r.enviado_em >= (hoje.d::timestamp at time zone 'America/Sao_Paulo')
          and (r.aberto_em is not null or r.acionado_em is not null or r.dispensado_em is not null)
      )
    ) order by (a.data + a.hora))
    from agenda a
    left join pessoais pe on pe.id = a.pessoal_id
    left join servicos sv on sv.id = a.servico_id, agora
    where a.status = 'planejado' and a.hora is not null
      and (a.data + a.hora) <= agora.t
      and (a.data + a.hora) > agora.t - interval '30 minutes'
      and not exists (select 1 from com_toque ct where ct.id = a.id)
  ), '[]'::jsonb),
  'agenda_hoje', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'titulo', coalesce(nullif(btrim(pe.titulo), ''), a.titulo), 'hora', to_char(a.hora,'HH24:MI'),
      'cidade', a.cidade, 'tipo', a.tipo
    ) order by a.hora)
    from agenda a
    left join pessoais pe on pe.id = a.pessoal_id, hoje
    where a.status = 'planejado' and a.hora is not null and a.data = hoje.d
  ), '[]'::jsonb),
  'rotinas_na_hora', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'titulo', r.titulo,
      'hora', case when r.hora ~ '^[0-9]{2}:[0-9]{2}' then substr(r.hora, 1, 5) end,
      'adiada_ate', case when (r.adiada_ate at time zone 'America/Sao_Paulo')::date = hoje.d
                         then to_char(r.adiada_ate at time zone 'America/Sao_Paulo', 'HH24:MI') end
    ) order by r.hora)
    from rotinas r, agora, hoje
    where r.ativo and r.fixar_topo
      and coalesce(greatest(r.ultima_execucao, r.nao_fiz_em) + coalesce(r.intervalo_dias, 1), hoje.d) <= hoje.d
      and case when r.hora ~ '^[0-9]{2}:[0-9]{2}' then (hoje.d + substr(r.hora, 1, 5)::time) <= agora.t else true end
      and (r.adiada_ate is null or r.adiada_ate <= now())
  ), '[]'::jsonb),
  'agua', (
    select case when max(w.bebi_em) is null then null else jsonb_build_object(
      'ultima', to_char(max(w.bebi_em) at time zone 'America/Sao_Paulo', 'HH24:MI'),
      'ultima_id', floor(extract(epoch from max(w.bebi_em)))::bigint,
      'minutos', floor(extract(epoch from (now() - max(w.bebi_em)))/60)::int
    ) end
    from agua w
  ),
  'caixa', coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'texto', left(c.texto, 160)))
    from caixa_entrada c
    where c.processado = false and c.criado_em > now() - interval '24 hours'
  ), '[]'::jsonb),
  'duvidas', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'pergunta', left(d.pergunta, 200), 'contexto', left(d.contexto, 120), 'opcoes', d.opcoes,
      'origem', d.origem, 'cliente', c.nome, 'criado_em', d.criado_em
    ) order by d.criado_em)
    from duvidas_agente d left join clientes c on c.id = d.cliente_id
    where d.status = 'aberta' and d.criado_em > now() - interval '24 hours'
  ), '[]'::jsonb),
  'contas', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'descricao', c.descricao, 'categoria', c.categoria, 'escopo', c.escopo,
      'valor', c.valor, 'data', c.data, 'dias', c.dias
    ) order by c.data, c.valor desc)
    from contas c
  ), '[]'::jsonb),
  'resumo', (select jsonb_build_object(
    'compromissos_hoje',  (select count(*) from agenda a,     hoje where a.status='planejado' and a.data = hoje.d and a.hora is not null),
    'proximo_hoje',       (select to_char(min(a.hora),'HH24:MI') from agenda a, hoje where a.status='planejado' and a.data = hoje.d and a.hora is not null),
    'retornos_vencidos',  (select count(*) from servicos s,    hoje where s.status in ('lead','orcamento') and s.prazo is not null and s.prazo < hoje.d),
    'contas_vencendo',    (select count(*) from contas),
    'contas_valor',       (select coalesce(sum(valor),0)::numeric(12,2) from contas),
    'caixa_pendente',     (select count(*) from caixa_entrada where processado = false)
  ))
);
$function$;

-- 6. push_acao, botão Adiar 1h do aviso de compromisso:
--    - aviso velho (o card já mudou de dia ou hora depois que ele saiu) não mexe em nada, só sai da barra;
--    - card cuja hora já passou vai pra AGORA + 1h (arredondado pros 5 min seguintes, igual ao Adiar 1h do app), e não
--      mais pra hora marcada + 1h, que caía logo ali e avisava de novo; card que ainda vai acontecer segue hora + 1h;
--    - a data acompanha, sem passar da meia-noite; visita/pessoal que bate em outro horário empurra de minuto em minuto;
--    - o recado nasce lido: recado aberto esconde o card do app e do celular até a Manu ler (regressão de hoje cedo);
--    - o lembrete de 60 min antes da hora nova não sai (ele acabou de mexer no card).
CREATE OR REPLACE FUNCTION public.push_acao(p_recibo uuid, p_acao text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r public.push_recibos%rowtype;
  plano jsonb;
  linha record;
  ag public.agenda%rowtype;
  agora_sp timestamp := (now() at time zone 'America/Sao_Paulo');
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  marcado timestamp;
  novo timestamp;
  tentativa int;
  rt_titulo text;
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
      -- Aviso velho: o plano guarda o dia e a hora do card quando o aviso saiu. Card já remarcado não é empurrado.
      if plano ? 'hora' and (plano ->> 'hora' is distinct from to_char(ag.hora, 'HH24:MI')
                             or (plano ? 'data' and plano ->> 'data' is distinct from ag.data::text)) then
        update push_recibos set acionado_em = now(), acao = p_acao where recibo = p_recibo;
        return jsonb_build_object('ok', true, 'motivo', 'card ja mudou de horario');
      end if;
      marcado := ag.data + ag.hora;
      if marcado > agora_sp then
        novo := marcado + interval '1 hour';
      else
        novo := to_timestamp(ceil(extract(epoch from agora_sp + interval '1 hour') / 300) * 300) at time zone 'UTC';
      end if;
      if novo::date > greatest(ag.data, hoje) then
        novo := greatest(ag.data, hoje) + time '23:55';
      end if;
      for tentativa in 0..5 loop
        begin
          update agenda set data = novo::date, hora = novo::time where id = ag.id;
          exit;
        exception when unique_violation then
          if tentativa = 5 then raise; end if;
          novo := novo + interval '1 minute';
        end;
      end loop;
      insert into agenda_recados (agenda_id, acao, texto, processado_em, resultado)
      values (ag.id, 'recado',
              'Adiou 1 hora pela notificação (era ' || to_char(ag.hora, 'HH24:MI') || ', agora ' || to_char(novo, 'HH24:MI')
                || case when novo::date <> ag.data then ' de ' || to_char(novo, 'DD/MM') else '' end || ')',
              now(), 'Já mudado pela notificação.');
      perform push_reservar(array['agenda:' || ag.id::text || ':' || novo::date::text || ':' || to_char(novo, 'HH24:MI')]);
      insert into historico (o_que, por, detalhe)
      values ('Adiou 1h pela notificação: ' || left(coalesce(ag.titulo, ''), 80), 'diego',
              'agenda ' || ag.id::text || ' · antes: ' || to_char(ag.data, 'DD/MM') || ' ' || to_char(ag.hora, 'HH24:MI')
                || ' → depois: ' || to_char(novo, 'DD/MM HH24:MI'));
    else
      return jsonb_build_object('ok', false, 'motivo', 'resposta sem tratamento');
    end if;

  elsif plano ->> 'tabela' = 'rotinas' then
    -- Os mesmos campos do ✓ Feito e do ⏰ Adiar 1h do RotinasCard no app.
    if plano ->> 'resposta' = 'feito' then
      update rotinas set ultima_execucao = hoje, adiada_ate = null
       where id = (plano ->> 'id')::uuid and ativo returning titulo into rt_titulo;
    elsif plano ->> 'resposta' = 'adiar' then
      update rotinas set adiada_ate = now() + interval '1 hour'
       where id = (plano ->> 'id')::uuid and ativo returning titulo into rt_titulo;
    else
      return jsonb_build_object('ok', false, 'motivo', 'resposta sem tratamento');
    end if;
    if rt_titulo is null then
      update push_recibos set acionado_em = now(), acao = p_acao where recibo = p_recibo;
      return jsonb_build_object('ok', true, 'motivo', 'rotina desativada');
    end if;
    insert into historico (o_que, por, detalhe)
    values (case when plano ->> 'resposta' = 'feito' then 'Rotina feita pela notificação: ' else 'Rotina adiada 1h pela notificação: ' end || left(rt_titulo, 80),
            'diego', 'rotina ' || (plano ->> 'id'));

  elsif plano ->> 'tabela' = 'agua' then
    -- Bebi: um copo. Se o Bebi do app já gravou um copo nos últimos 10 min, não conta duas vezes.
    if plano ->> 'resposta' <> 'bebi' then
      return jsonb_build_object('ok', false, 'motivo', 'resposta sem tratamento');
    end if;
    if not exists (select 1 from agua where bebi_em > now() - interval '10 minutes') then
      insert into agua default values;
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

-- 7. push_validar: dos recibos que estão na barra do celular, quais já não valem. O service worker (a cada aviso que
--    chega e a cada toque) e o app (a cada carga) perguntam por push-enviar?modo=validar e fecham esses.
--    Aviso com mais de 24h sai sempre. Por tipo:
--      agenda-<id>: card fora de planejado, em outro dia/hora (pelo item; recibo antigo sem item: hora do card longe da
--        hora do envio), com toque pendente (Remarcar, recado, Manu resolve; a visita que ainda vai acontecer fica), ou
--        card "Decidir" ou que a Zapia manda (Follow-up N, Contato Zapia, Zapia envia), que não avisa mais;
--      rotina-<id>: desligada, desafixada, feita ou não-fiz hoje, adiada;
--      agua: bebeu depois do aviso;
--      caixa-<id> / caixa-lote: a Manu já processou;
--      conta-<id> / contas-d3: paga (sem item, contas-d3 antigo sai);
--      resumo-diario: de ontem ou com mais de 6h;
--      duvida-<id>: respondida;
--      teste: mais de 1h.
CREATE OR REPLACE FUNCTION public.push_validar(p_recibos uuid[])
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with agora as (select (now() at time zone 'America/Sao_Paulo') as t, (now() at time zone 'America/Sao_Paulo')::date as d),
     com_toque as (
       select rc.agenda_id as id from agenda_recados rc
       where rc.processado_em is null and rc.acao in ('remarcar', 'recado')
       union
       select a.id from agenda a
       where a.status = 'planejado' and exists (
         select 1 from caixa_entrada c
         where c.processado is not true
           and c.conversa @> jsonb_build_array(jsonb_build_object('meta', jsonb_build_object('origem', 'manu_resolve', 'agenda_id', a.id::text))))
     ),
     r as (select pr.* from push_recibos pr where pr.recibo = any(p_recibos))
select coalesce(array_agg(r.recibo), '{}'::uuid[])
from r, agora
where r.enviado_em < now() - interval '24 hours'
   or case
     when r.tag like 'agenda-%' then not exists (
       select 1 from agenda a
       where a.id::text = substr(r.tag, 8)
         and a.status = 'planejado' and a.hora is not null
         and case when r.item ? 'hora'
                  then to_char(a.hora, 'HH24:MI') = r.item ->> 'hora' and a.data::text = coalesce(r.item ->> 'data', a.data::text)
                  else ((a.data + a.hora) at time zone 'America/Sao_Paulo') between r.enviado_em - interval '31 minutes' and r.enviado_em + interval '61 minutes'
             end
         and not (a.id in (select ct.id from com_toque ct) and not (a.tipo = 'presencial' and (a.data + a.hora) > agora.t))
         and coalesce(a.titulo, '') !~* '^\s*decidir\M'
         and coalesce(a.titulo, '') !~* '^\s*(follow[\s-]?up\s*\d+|contato\s+zapia|zapia\s+(envia|manda))\s*[—–-]')
     when r.tag like 'rotina-%' then not exists (
       select 1 from rotinas ro
       where ro.id::text = substr(r.tag, 8) and ro.ativo and ro.fixar_topo
         and coalesce(greatest(ro.ultima_execucao, ro.nao_fiz_em) + coalesce(ro.intervalo_dias, 1), agora.d) <= agora.d
         and (ro.adiada_ate is null or ro.adiada_ate <= now()))
     when r.tag = 'agua' then exists (select 1 from agua w where w.bebi_em > r.enviado_em)
     when r.tag = 'caixa-lote' then not exists (select 1 from caixa_entrada c where c.processado = false and c.criado_em <= r.enviado_em)
     when r.tag like 'caixa-%' then not exists (select 1 from caixa_entrada c where c.id::text = substr(r.tag, 7) and c.processado = false)
     when r.tag = 'contas-d3' then not exists (
       select 1 from financeiro f
       where f.status = 'a_pagar'
         and f.id::text in (select jsonb_array_elements_text(coalesce(r.item -> 'ids', '[]'::jsonb))))
     when r.tag like 'conta-%' then not exists (select 1 from financeiro f where f.id::text = substr(r.tag, 7) and f.status = 'a_pagar')
     when r.tag = 'resumo-diario' then (r.enviado_em at time zone 'America/Sao_Paulo')::date < agora.d or r.enviado_em < now() - interval '6 hours'
     when r.tag like 'duvida-%' then not exists (select 1 from duvidas_agente d where d.id::text = substr(r.tag, 8) and d.status = 'aberta')
     when r.tag = 'teste' then r.enviado_em < now() - interval '1 hour'
     else false
   end
$function$;

revoke all on function public.push_validar(uuid[]) from public, anon, authenticated;

grant execute on function public.push_validar(uuid[]) to service_role;

-- 8. Adiar 1h no app (card atrasado e alarme da tela): segura o lembrete de 60 min da hora nova, como o Adiar da
--    notificação faz. Sem isto, o card adiado pra daqui a 1h ganhava "em 55 min" logo em seguida.
CREATE OR REPLACE FUNCTION public.push_segurar_lembrete(p_agenda uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not coalesce(public.usuario_autorizado(), false) then
    raise exception 'Conta não autorizada.' using errcode = '42501';
  end if;
  perform push_reservar(array['agenda:' || a.id::text || ':' || a.data::text || ':' || to_char(a.hora, 'HH24:MI')])
     from agenda a
    where a.id = p_agenda and a.status = 'planejado' and a.data is not null and a.hora is not null;
end;
$function$;

revoke all on function public.push_segurar_lembrete(uuid) from public, anon;

grant execute on function public.push_segurar_lembrete(uuid) to authenticated, service_role;

-- 9. Virada sem repetir (rodar logo antes do deploy do push-enviar): as chaves novas levam o dia, então quem já está
--    na janela de 60 min, ou já recebeu o aviso na hora hoje, ganha a chave nova como já avisado.
insert into public.push_enviados (chave)
select 'agenda:' || a.id::text || ':' || a.data::text || ':' || to_char(a.hora, 'HH24:MI')
from public.agenda a
where a.status = 'planejado' and a.data is not null and a.hora is not null
  and (a.data + a.hora) <= (now() at time zone 'America/Sao_Paulo') + interval '75 minutes'
on conflict (chave) do nothing;

insert into public.push_enviados (chave)
select 'agenda-hora:' || x.m[1] || ':' || (e.enviado_em at time zone 'America/Sao_Paulo')::date::text
       || case when x.m[3] = '0' then ':' || x.m[2] || ':0' else ':r' || x.m[3] end
from public.push_enviados e
cross join lateral (select regexp_match(e.chave, '^agenda-hora:([0-9a-f-]{36}):([0-9]{2}:[0-9]{2}):([0-9]+)$') as m) x
where x.m is not null
  and e.enviado_em >= ((now() at time zone 'America/Sao_Paulo')::date::timestamp at time zone 'America/Sao_Paulo')
on conflict (chave) do nothing;

-- 10. Conferência.
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'push_recibos' and column_name in ('dispensado_em', 'item')) as colunas_novas,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('push_validar', 'push_segurar_lembrete')) as funcoes_novas,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'push_recibo_abrir') as recibo_abrir_versoes;

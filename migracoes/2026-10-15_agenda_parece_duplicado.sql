-- 15/10/2026. A Manu não achava no banco o "Parece duplicado" que o app mostra: a regra era só da tela
-- (ligacoesDaLista em nova.html). Esta view expõe a MESMA regra, só leitura: dois ou mais cards planejados do
-- mesmo serviço no mesmo dia cujo título começa com buscar/retirar/entregar/levar/pegar. Aplicada no banco.
create or replace view public.agenda_parece_duplicado with (security_invoker = true) as
select a.id, a.servico_id, a.cliente_id, a.data, a.hora, a.tipo, a.titulo,
  (select string_agg(b.titulo, ' | ' order by b.hora)
     from public.agenda b
    where b.servico_id = a.servico_id and b.data = a.data and b.id <> a.id and b.status = 'planejado'
      and b.pessoal_id is null and b.titulo ~* '\m(busc|retir|entreg|levar|pegar)') as outros_cards
from public.agenda a
where a.status = 'planejado' and a.servico_id is not null and a.pessoal_id is null
  and a.titulo ~* '\m(busc|retir|entreg|levar|pegar)'
  and exists (select 1 from public.agenda b
               where b.servico_id = a.servico_id and b.data = a.data and b.id <> a.id and b.status = 'planejado'
                 and b.pessoal_id is null and b.titulo ~* '\m(busc|retir|entreg|levar|pegar)');

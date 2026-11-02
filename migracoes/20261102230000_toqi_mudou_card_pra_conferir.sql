-- TOQI MUDOU, DIEGO CONFERE (02/11/2026, revisão do app, item 2; Diego: "Então aplique"). Desde 02/11 a Toqi grava
-- direto na agenda pelo login dela (política toqi_altera: usuario_mural() e financeiro_id nulo). Quando ela muda DIA ou
-- HORA de um card planejado, o Painel precisa mostrar pra ele conferir: é o mesmo selo "🔁 Mudança pra você conferir"
-- (nota_claude + nota_claude_conferida = false) que a Manu usava, só que agora quem escreve é o banco, porque a Toqi
-- não tem app e nenhuma rotina lê mais os recados.
--
-- Só dispara quando quem grava é o login do Mural (usuario_mural() verdadeiro): o Diego pelo app nunca marca a si
-- mesmo, e rotina/serviço (auth.uid() nulo) também não. Não apaga nada, não mexe em dinheiro: só nota_claude,
-- nota_claude_em e nota_claude_conferida. Idempotente: create or replace + drop trigger if exists.
--
-- APLICAR JUNTO COM O V do PR "Remarcar na hora, Toqi no Painel": o app de antes manda o "Mudar" do selo pra fila da
-- Manu (que ninguém lê mais) e esconde o card. O app novo pergunta o dia na hora. Reversão em rollback/toqi_mudou_card_pra_conferir.sql.

create or replace function private.trg_agenda_toqi_mudou_conferir()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public', 'private'
as $$
declare
  resto text;
  de_onde text;
  pra_onde text;
begin
  if new.status is distinct from 'planejado' then return new; end if;
  if new.data is not distinct from old.data and new.hora is not distinct from old.hora then return new; end if;
  if not coalesce(public.usuario_mural(), false) then return new; end if;
  de_onde := coalesce(to_char(old.data, 'DD/MM'), 'sem data') || coalesce(' ' || left(old.hora::text, 5), '');
  pra_onde := coalesce(to_char(new.data, 'DD/MM'), 'sem data') || coalesce(' ' || left(new.hora::text, 5), '');
  -- Mantém o que já estava na nota, menos um "Toqi mudou" antigo (pra não empilhar); a linha nova vai na frente.
  resto := btrim(regexp_replace(coalesce(new.nota_claude, ''), '(^|\n)Toqi mudou pelo Mural:[^\n]*', '', 'g'), E' \n');
  new.nota_claude := 'Toqi mudou pelo Mural: de ' || de_onde || ' para ' || pra_onde
    || case when resto <> '' then E'\n' || resto else '' end;
  new.nota_claude_em := now();
  new.nota_claude_conferida := false;
  return new;
end
$$;

drop trigger if exists agenda_toqi_mudou_conferir on public.agenda;
create trigger agenda_toqi_mudou_conferir
  before update of data, hora on public.agenda
  for each row execute function private.trg_agenda_toqi_mudou_conferir();

-- Confere: o gatilho existe e aponta pra função certa.
select t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) as definicao
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where c.relname = 'agenda' and t.tgname = 'agenda_toqi_mudou_conferir';

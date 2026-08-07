-- ============================================================================
-- TRAVAS NO BANCO — Tapeçaria Bahia — escrito em 24/07/2026
--
-- POR QUE NO BANCO E NÃO NA TELA: as sessões de IA gravam direto na REST API do
-- Supabase (é o jeito rápido e confiável, a tela trava). Isso PULA todo aviso do
-- nova.html e toda regra do Guia da IA. Regra escrita é texto: sessão burra ou
-- alucinada ignora. Trava no banco não tem como ignorar — o INSERT falha e pronto.
-- Pedido do Diego em 24/07/2026: "não adianta só corrigir e não existir travas;
-- mesmo que a sessão esteja burra, não ter opção a não ser fazer o certo."
--
-- COMO RODAR: Supabase > SQL Editor > cola e executa. Bloco por bloco.
--
-- NOT VALID = a trava vale pra tudo que for gravado ou alterado DAQUI PRA FRENTE,
-- e não briga com as linhas velhas que já estão erradas. É de propósito: travar o
-- futuro sem quebrar o app hoje. As linhas velhas estão listadas em cada bloco.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- TRAVA 1 — não dá pra marcar como FEITO um compromisso que ainda não aconteceu
-- O erro real: 18 compromissos futuros ficaram "feito" (Carla 28/07, Matheus
-- 31/07, Débora 25/07...). O app só carrega status 'planejado', então todos
-- sumiram da tela — pareceu que o cliente tinha evaporado.
-- Fuso de Brasília de propósito: o Diego trabalha de madrugada, e em UTC já é o
-- dia seguinte às 21h — sem isso a trava liberaria justo na hora que ele usa.
-- ----------------------------------------------------------------------------
create or replace function trava_agenda_feito_no_futuro() returns trigger as $$
begin
  if new.status = 'feito'
     and new.data > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception
      'Compromisso de % ainda não aconteceu — não pode virar feito. Se saiu da agenda, apague ou reagende; se já resolveu antes da hora, mude a data.',
      new.data;
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists trg_agenda_feito_no_futuro on agenda;
create trigger trg_agenda_feito_no_futuro
  before insert or update on agenda
  for each row execute function trava_agenda_feito_no_futuro();
-- Linhas velhas em conflito: 14. O trigger não mexe nelas (só pega gravação nova),
-- mas qualquer UPDATE nelas vai exigir corrigir o status antes.


-- ----------------------------------------------------------------------------
-- TRAVA 2 — compra de material SEMPRE com fornecedor (Regra Nº 8)
-- O erro real: material comprado no dia 23/07 nunca virou lançamento, e a aba
-- Compras ficou vazia — margem de serviço mentirosa.
-- ----------------------------------------------------------------------------
alter table financeiro drop constraint if exists financeiro_material_precisa_fornecedor;
alter table financeiro add constraint financeiro_material_precisa_fornecedor
  check (categoria is distinct from 'Material' or fornecedor_id is not null) not valid;
-- Linhas velhas em conflito: 1 ("[CONFERIDO] Percintas e madeiras" R$16 de 17/07).


-- ----------------------------------------------------------------------------
-- TRAVA 3 — telefone tem que ser celular brasileiro de verdade
-- O erro real: contar dígitos não basta. "+55 61 92742-2663" tem os 13 dígitos
-- certos e mesmo assim é inválido — depois do DDD vem 9 e depois 6/7/8/9.
-- Foi assim que a Ju entrou duas vezes e ninguém percebeu.
-- ----------------------------------------------------------------------------
alter table clientes drop constraint if exists clientes_telefone_celular_br;
alter table clientes add constraint clientes_telefone_celular_br
  check (telefone is null
         or regexp_replace(telefone, '\D', '', 'g') ~ '^55[1-9][0-9]9[6-9][0-9]{7}$') not valid;
-- Linhas velhas em conflito: 4 — Débora Oliveira (85519-9962), Alberto Silva Lima
-- (85986-6685), "Cliente poltrona" (83239-9981) e Ju (92742-2663). Todas precisam
-- do número certo com o Diego; não dá pra deduzir qual dígito ele errou.


-- ----------------------------------------------------------------------------
-- TRAVA 4 — o mesmo telefone não pode existir em dois clientes
-- Esta é A trava do caso "Ju": identidade de cliente é o TELEFONE, nunca o nome.
-- Sem violação hoje (0 linhas), então entra valendo pra tudo, inclusive o passado.
-- ----------------------------------------------------------------------------
drop index if exists clientes_telefone_unico;
create unique index clientes_telefone_unico
  on clientes ((regexp_replace(telefone, '\D', '', 'g')))
  where telefone is not null;


-- ----------------------------------------------------------------------------
-- TRAVA 5 — serviço entregue tem que ter valor
-- O erro real: 7 serviços entregues sem valor nenhum (as duas da Dona Relva,
-- Klaus, Taisa, Gabi, Brito Odontologia, Vinícius). Trabalho entregue sem
-- faturamento registrado é dinheiro que some sem ninguém ver.
-- ----------------------------------------------------------------------------
alter table servicos drop constraint if exists servicos_entregue_precisa_valor;
alter table servicos add constraint servicos_entregue_precisa_valor
  check (status <> 'entregue' or valor_orcamento is not null) not valid;
-- Linhas velhas em conflito: 7.


-- ----------------------------------------------------------------------------
-- TRAVA 6 — compromisso presencial precisa de hora e cidade (Regra Nº 4)
-- Sem cidade a trava de rota fica cega; sem hora ele não sabe encaixar na viagem.
-- ----------------------------------------------------------------------------
alter table agenda drop constraint if exists agenda_presencial_precisa_hora_cidade;
alter table agenda add constraint agenda_presencial_precisa_hora_cidade
  check (tipo is distinct from 'presencial'
         or (hora is not null and cidade is not null and btrim(cidade) <> '')) not valid;
-- Linhas velhas em conflito: 1 sem hora, 1 sem cidade.


-- ----------------------------------------------------------------------------
-- TRAVA 7 — não dá pra criar o mesmo compromisso duas vezes
-- O erro real: "Buscar poltrona - Andriele" 03/08 existe duplicado (um feito,
-- um planejado). Índice único não aceita NOT VALID — TEM QUE limpar a duplicata
-- ANTES de rodar este bloco, senão a criação falha.
-- ----------------------------------------------------------------------------
-- Confere antes:
--   select servico_id, titulo, data, count(*) from agenda
--   group by 1,2,3 having count(*) > 1;
drop index if exists agenda_sem_duplicata;
create unique index agenda_sem_duplicata
  on agenda (servico_id, titulo, data)
  where servico_id is not null;


-- ============================================================================
-- FICOU DE FORA DE PROPÓSITO
--
-- "Serviço ativo tem que ter compromisso planejado" — é a raiz do problema (49
-- de 53 serviços ativos sem nenhuma data marcada), mas NÃO pode virar trava de
-- banco: entre concluir um compromisso e marcar o próximo existe um instante
-- legítimo sem nenhum, e travar isso quebraria o botão Concluir no meio da rua.
-- Esse caso é alerta no Painel, não bloqueio.
--
-- "Agendado/produção precisa de valor" — também não: visita de orçamento entra
-- como agendado sem valor e está certo (caso da Shirlei).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- TRAVA 8 — item com print não fecha sem alguém ter aberto o print
-- Escrita em 07/08/2026, a pedido do Diego.
--
-- A HISTÓRIA: a REGRA Nº 1 ("sempre abrir e ler o print antes de decidir") existe
-- desde 14/07. Em 04/08 o Diego pediu "um pop-up na hora de concluir perguntando
-- se viu o print" e o que entrou foi um selo na fila + um aviso ao lado do botão.
-- No MESMO dia 04/08 o print da Wesliane passou batido, expirou, e o serviço dela
-- (R$1.650, prazo 24/08) está até hoje sem lista de material.
--
-- POR QUE O AVISO NÃO PEGOU: selo e aviso vivem na TELA DE TRIAGEM, e as sessões
-- de IA não usam a tela — gravam direto na REST. O aviso cercava o Diego, que não
-- é quem pula print. Diego, 07/08: "outras sessões sempre esquecem". Está certo:
-- regra o modelo ignora, aviso na tela o modelo nem vê. Trigger o modelo não dribla.
--
-- COMO PASSAR PELA TRAVA (o jeito certo, não o contorno): abrir a imagem, ler
-- nome/telefone/cidade/material/medidas, e gravar em `conversa` uma mensagem com
-- meta {"print_lido": true} junto do que foi lido. É uma linha a mais e é o
-- registro de que a informação da imagem entrou na decisão.
--
-- O DIEGO NUNCA É TRAVADO: quem confirma pela tela de triagem está com o print
-- aberto na frente (o painel renderiza a galeria acima do botão), e o resolveInbox
-- do nova.html carimba print_lido sozinho nesse caminho.
-- ----------------------------------------------------------------------------
create or replace function trava_caixa_print_precisa_ser_lido() returns trigger as $$
begin
  if new.processado = true
     and coalesce(old.processado, false) = false
     and new.texto like '%[[TB_INBOX_IMG]]%'
     and not exists (
       select 1
       from jsonb_array_elements(coalesce(new.conversa::jsonb, '[]'::jsonb)) as m
       where (m -> 'meta' ->> 'print_lido') = 'true'
     ) then
    raise exception
      'Este item tem print e nada registra que ele foi aberto. Abra a imagem, leia o que está nela (nome, telefone, cidade, material, medidas) e grave em conversa uma mensagem com meta {"print_lido": true} antes de processar. REGRA Nº 1 — foi assim que o print da Wesliane passou batido em 04/08 e o serviço dela ficou sem material.';
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists trg_caixa_print_precisa_ser_lido on caixa_entrada;
create trigger trg_caixa_print_precisa_ser_lido
  before insert or update on caixa_entrada
  for each row execute function trava_caixa_print_precisa_ser_lido();

-- Só pega a gravação que ACABA de virar processado=true (o coalesce do old cuida
-- disso), então item já fechado no passado continua como está e não trava numa
-- edição futura qualquer.
--
-- PRA DESFAZER, se atrapalhar:
--   drop trigger if exists trg_caixa_print_precisa_ser_lido on caixa_entrada;

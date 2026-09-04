-- CAIXA DE AVISOS OPERACIONAIS — item AGENDA-CAIXA-AVISOS-20260831-001 (recado de 29/08).
--
-- O PROBLEMA, com caso vivo: o compromisso da Fátima (09/09, Valparaíso) carrega no campo `agenda.local`
-- 357 caracteres de condição operacional — "slot interno provisório 13:30, não confirmado externamente,
-- RETIRADA TRABALHOSA: exige desmontagem do sofá, proteger a janela da tarde, cruzar rota apenas se não
-- apertar a execução". Isso é um AVISO escrito no campo do ENDEREÇO, e some duas vezes:
--   1. ninguém lê `local` antes de marcar outra coisa, então a condição não chega a quem decide;
--   2. o botão de rota mandava o parágrafo inteiro pro Maps buscar (o app não achava coordenada,
--      e a frase não casava nenhum dos filtros de "isso não é endereço" que já existiam).
--
-- Condição operacional precisa de casa própria. É o que esta tabela é.
--
-- ENXUTA DE PROPÓSITO, e o recado é explícito: "não transformar isso em diário, journal, claim, protocolo,
-- ENTRADAS/PROCESSADOS ou nova arquitetura pesada". São 8 colunas, uma leitura por abertura, e aviso ativo
-- NÃO eleva o fluxo para FULL — ele só aparece na hora de decidir.
--
-- A CIDADE NÃO MORA AQUI, de propósito: `referencia_id` aponta a linha de origem (o compromisso da agenda)
-- e a cidade é lida DE LÁ. Guardar a cidade nos dois lugares cria duas verdades que divergem no dia em que
-- o compromisso for remarcado para outro lugar — o mesmo erro que a procedência no campo `local` já causou.

create table if not exists public.avisos_operacionais (
  id uuid primary key default gen_random_uuid(),
  dominio text not null default 'agenda'
    check (dominio in ('agenda','financeiro','producao','compras','geral')),
  aviso text not null,
  prioridade text not null default 'media' check (prioridade in ('alta','media','baixa')),
  ativo boolean not null default true,
  -- Aviso vencido é ruído, e ruído faz ele parar de ler o aviso que importa. O app filtra por esta data;
  -- nulo = vale até alguém desligar em `ativo`.
  expira_em date,
  referencia_id uuid,
  criado_em timestamptz not null default now()
);

-- Índice parcial: a leitura do app é sempre "avisos vivos deste domínio". Não indexar o que está desligado.
create index if not exists avisos_operacionais_vivos
  on public.avisos_operacionais (dominio, prioridade)
  where ativo;

alter table public.avisos_operacionais enable row level security;

drop policy if exists avisos_operacionais_autorizado on public.avisos_operacionais;
create policy avisos_operacionais_autorizado on public.avisos_operacionais
  for all using ((select public.usuario_autorizado())) with check ((select public.usuario_autorizado()));

comment on table public.avisos_operacionais is
  'Caixa de Avisos Operacionais (item AGENDA-CAIXA-AVISOS-20260831-001). Condicao operacional viva que quem for criar/alterar/remarcar compromisso precisa ver ANTES de agir. Enxuta de proposito: nao e diario, journal, claim nem protocolo. referencia_id aponta o registro de origem (ex.: o compromisso da agenda) e a cidade e lida DE LA, para nao duplicar dado que ja existe e pode divergir.';

-- O primeiro aviso real, tirado do campo `local` do compromisso da Fátima. NÃO apaguei o texto de lá:
-- o dado é do Classic e quem reescreve o campo dele é ele. O app parou de mandar a anotação pro Maps
-- cortando no `|` e ficando com o endereço ("Jardim Oriente — Valparaíso de Goiás"), que é o que serve
-- para chegar lá. Ver a mudança em `localBruto`, no CompromissoCard.
--
--   insert into public.avisos_operacionais (dominio, aviso, prioridade, expira_em, referencia_id)
--   values ('agenda', 'Retirada ainda PROVISÓRIA — ...', 'alta', '2026-09-09',
--           '1f6393b5-0f57-4506-a8d0-131de0e50e4e');
--
-- (aplicado em 03/09/2026; fica comentado aqui porque é dado, não estrutura)

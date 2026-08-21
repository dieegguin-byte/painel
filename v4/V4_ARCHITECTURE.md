# Operação Bahia V4 — Arquitetura Base

**Status:** PROTÓTIPO / NÃO PRODUÇÃO  
**Data-base:** 20-08-2026  
**Regra P0:** nada neste diretório substitui `nova.html`, altera schema, tarefas, Calendar, Windsor, campanhas ou dados operacionais.

## Objetivo

Construir uma nova Central Operacional sem reformar a V3 em produção. A V4 nasce isolada e só poderá substituir a V3 após shadow mode, testes e autorização explícita.

## Princípios

1. Supabase continua fonte oficial dos fatos vivos.
2. Calendar continua espelho da agenda.
3. Biblioteca + Skills continuam fonte das regras operacionais.
4. Classic continua interface conversacional/central de comando.
5. App V4 é interface móvel, não nova fonte de verdade.
6. Windsor é adaptador de marketing, não CRM.
7. GitHub guarda código/sites; mudança crítica passa por branch + PR.
8. Automação executa o seguro e escala apenas exceções humanas.
9. Toda escrita importante precisa de idempotência + readback.
10. Caixa de Entrada é conceito legado e não existe como módulo da V4.

## Módulos de usuário

### Principal
- Hoje
- Clientes
- Serviços
- Agenda
- Compras
- Financeiro

### Mais
- Profissionais
- Fornecedores
- Crescimento
- Automação
- Sites & Tecnologia
- Configurações

### Conceitos absorvidos
- Leads = visão/filtro de Clientes + Serviços.
- A pagar = visão do Financeiro.
- Rotinas = Automação.
- Fornecedores continuam entidade, mas participam principalmente de Compras.
- Caixa não aparece na navegação.

## Modelo operacional

```text
Classic | App | Sites | Tarefas | Windsor | APIs
                         |
                         v
                 operational_events
                         |
                         v
                  motor de decisão
                  /      |       \
              executa  agenda   aprovação
                seguro  próxima  humana
                  \      |       /
                         v
                 serviços de domínio
                         |
                         v
                      Supabase
                         |
                         v
              integrações + readback
```

A Caixa atual será decomposta em três conceitos internos:

- `operational_events`: o que aconteceu;
- `commands`: o que precisa ser executado;
- `approvals`: somente decisões que realmente dependem de Diego.

`approvals` não pode virar uma Caixa de Entrada com outro nome.

## Estruturas atuais a preservar inicialmente

- clientes
- servicos
- agenda
- financeiro
- fornecedores
- fotos
- dividas
- historico
- marketing_atribuicoes

`caixa_entrada` permanece legado durante a transição. Não apagar enquanto existir histórico, regra ou fluxo dependente dela.

## Estruturas propostas — NÃO CRIAR EM PRODUÇÃO NESTA FASE

- operational_events
- commands
- approvals
- automation_definitions
- automation_runs
- profissionais
- service_materials
- purchase_orders
- purchase_items
- sites
- site_integrations

## Operações compostas

Contratos funcionais já validados na V3 devem ser preservados, mas movidos para backend transacional/idempotente:

- entrada_servico
- servico_fechado
- material_planejado
- material_em_transito
- material_em_maos
- lista_compra_confirmada
- vale_entregue
- vale_abatido
- mao_de_obra_anotada
- mao_de_obra_acertada
- compromisso_concluido
- entrega_concluida
- remarcacao_com_data
- remarcacao_terminal

Na V4 o frontend envia um comando. O backend valida, executa os efeitos relacionados atomicamente e devolve readback. Não reproduzir operação composta como sequência frágil de updates no navegador.

## Automação 24 horas

A operação alvo é orientada a eventos. Exemplo:

```text
material_em_maos
-> validar serviço e itens necessários
-> liberar produção somente se permitido
-> recalcular capacidade
-> definir próxima ação
-> registrar auditoria
```

Os checkpoints 06h / 23h / 23h30 / 23h55 permanecem como supervisores: reconciliam, recuperam falhas, geram briefing, conferem backup e auditam. Eles não devem ser o único motor que faz a operação avançar.

## Crescimento / Windsor

Fluxo alvo:

```text
investimento -> clique -> contato -> orçamento -> fechamento -> receita recebida -> margem confirmada
```

Atribuição só usa evidência real: tracking_ref, gclid/gbraid/wbraid, UTMs, campanha, grupo, anúncio, landing page ou informação explicitamente confirmada.

Ações externas sensíveis permanecem atrás de autorização.

## Sites / GitHub

Criar futuramente registro de sites com: nome, domínio, repositório, branch de produção, prefixo de tracking, ambientes, status, última publicação e saúde.

A ponte Classic → GitHub mantém:

- allowlist;
- branch isolada `classic/*`;
- idempotência;
- `expected_sha` para atualizações;
- limites de arquivo/payload;
- segredos somente no executor;
- PR sem merge automático.

## Migração

### Fase 0 — protótipo
Arquivos apenas em `v4/`, dados mock, zero integração de produção.

### Fase 1 — leitura sombra
V4 lê estado real sem escrever e compara interpretação com operação atual.

### Fase 2 — backend/sandbox
Comandos transacionais, idempotência, autorização e testes fora da escrita real.

### Fase 3 — shadow mode real
V4 observa eventos reais e mostra o que faria, sem executar.

### Fase 4 — escrita limitada
Habilitar domínio por domínio com readback e rollback.

### Fase 5 — corte
Somente após autorização explícita, mantendo janela de reversão para V3.

## Travas P0

- zero merge automático para produção;
- zero migration de produção nesta fase;
- nenhuma service_role/segredo no frontend;
- nenhuma hipótese vira fato;
- Calendar não vira fonte única;
- atribuição de marketing nunca é inferida sem evidência;
- automações devem ser idempotentes;
- toda falha deve ficar observável;
- produção V3 continua funcionando até decisão de corte.

## Critério de aceite futuro

A V4 só substitui a V3 quando provar em paralelo que mantém fatos, agenda, financeiro, materiais, produção, profissionais e atribuição coerentes; funciona bem no celular; impede duplicidade; diferencia confirmado/provisório/sugestão; e deixa trilha auditável de cada ação.

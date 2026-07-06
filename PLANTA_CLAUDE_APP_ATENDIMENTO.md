# Planta do App Atendimento

Este arquivo existe para qualquer IA, especialmente o Claude, entender rápido como o app foi pensado, onde estão as partes principais e o que foi ajustado nesta rodada.

## O que este app é

O `app_atendimento` não foi montado como ERP tradicional. A ideia central dele é servir como painel operacional da Tapeçaria Bahia, juntando:

- entrada livre de informações
- acompanhamento de leads e serviços
- agenda operacional
- financeiro simplificado
- controle de estoque
- contexto persistente para IA operar melhor

O coração do app está todo em um arquivo só:

- `index.html`

Ele mistura estrutura HTML, estilos CSS e lógica JavaScript inline.

## Estrutura mental do app

O fluxo principal hoje é:

1. login por link mágico no e-mail
2. conferência ou criação de PIN
3. entrada no painel principal
4. navegação por abas

As abas principais são:

- `Início`
- `Leads`
- `Agenda`
- `Financeiro`
- `Estoque`

Também existem dois modais importantes:

- `Guia da IA`
- `Ficha do cliente`

## Onde cada parte fica em `index.html`

- autenticação e PIN: seções `AUTENTICAÇÃO` e `PIN`
- navegação por abas: seção `NAVEGAÇÃO POR ABAS`
- contexto para IA: seção `GUIA DA IA`
- ficha do cliente: seção `FICHA DO CLIENTE`
- dashboard inicial: função `renderInicio()`
- funil de leads: função `renderLeads()`
- agenda: função `renderAgenda()`
- financeiro: função `renderFinanceiro()`
- estoque: função `renderEstoque()`

## O que foi melhorado nesta rodada

As mudanças foram pensadas para deixar o app mais claro para operação humana e para uso por IA.

### 1. Fluxo de autenticação mais legível

Foi adicionada leitura do erro de autenticação vindo pela URL.

Se o link mágico expirar, o app agora consegue mostrar uma mensagem mais humana na tela de login em vez de depender só daquele hash confuso na URL.

Também foi adicionada limpeza automática dos parâmetros de autenticação da URL depois que a sessão entra. Isso ajuda porque:

- reduz confusão visual
- evita parecer que o app ainda está quebrado
- deixa o estado mais confiável para agentes

Funções novas ligadas a isso:

- `lerErroAuthDaUrl()`
- `limparHashAuth()`
- `atualizarInfoSessao()`

### 2. Estado de sessão visível no cabeçalho

Foi adicionado um texto de sessão no header mostrando o e-mail ativo quando a sessão existe.

Objetivo:

- deixar claro que o app está pronto para operar
- ajudar humano e IA a confirmarem quem está logado

Elemento novo:

- `#sessaoInfo`

### 3. Leads sem próxima ação agora ficam explícitos

Antes, um lead sem `proxima_acao` só parecia menos completo.

Agora ele ganha um aviso visual informando que falta definir o próximo passo. Isso é importante porque esse campo é central para a lógica do app.

Objetivo:

- evitar lead parado
- orientar melhor a operação
- deixar a IA menos dependente de adivinhação

### 4. Prazos mais claros

Os prazos dos leads agora distinguem melhor:

- `Hoje`
- `Prazo dd/mm`
- `Atrasado dd/mm`

Foi criada uma lógica específica para atraso:

- `ehAtrasado()`

Isso melhora bastante o uso diário, porque prioridade temporal fica mais óbvia.

### 5. Intenção de produto a preservar

Se outra IA for continuar mexendo aqui, vale manter esta lógica:

- o app deve continuar simples
- o app deve priorizar próxima ação
- o app deve parecer ferramenta de operação real, não sistema corporativo pesado
- o app deve facilitar ação rápida no celular
- o app deve ser compreensível para uma IA sem exigir interpretação ambígua do estado

## Próximas melhorias recomendadas

Se for continuar daqui, eu atacaria nesta ordem:

1. reforçar a ligação entre lead, agenda, financeiro e estoque
2. transformar mais estados em sinais explícitos para IA
3. reduzir textos ambíguos em botões e confirmações
4. criar ações rápidas por contexto, como `aguardando cliente`, `marcar visita` e `virar cobrança`
5. separar melhor o que é sugestão da IA e o que já foi executado

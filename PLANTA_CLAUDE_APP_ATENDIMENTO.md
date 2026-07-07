# Planta do App Atendimento

> Ultima atualizacao: 07/07/2026, America/Sao_Paulo
> Estado desta decisao: documentada e parcialmente implementada no codigo.

## Atualizacao de produto - 07/07/2026

### Caixa de entrada como primeira leitura operacional

Ao abrir o app, a `Caixa de entrada` deve ser tratada como primeira leitura do dia.

Motivo:

- o uso real nasce de conversa de WhatsApp
- como ainda nao existe API oficial integrada, parte da operacao continuara manual
- a IA precisa receber logo na abertura o material bruto do atendimento

Regra de produto:

- a caixa de entrada deve aparecer na primeira posicao da tela inicial
- ela deve aceitar texto colado e print/imagem
- print de conversa tambem conta como entrada valida
- o item da caixa deve poder ser editado, nao apenas apagado

### Prints agora fazem parte do fluxo oficial

Sem API do WhatsApp, o fluxo aceito passa a ser:

1. cliente manda mensagem no WhatsApp
2. Diego ou a IA colam o texto no app, ou sobem um print da conversa
3. a entrada fica registrada como pendencia operacional
4. depois essa entrada deve ser convertida em ficha, lead, historico e proxima acao

Importante para qualquer IA:

- nao tratar print como anexo secundario
- print pode conter contexto essencial do cliente
- se houver print sem texto, ainda assim ele deve entrar na triagem
- o objetivo da caixa nao e arquivar conversa, e sim facilitar a criacao da ficha do cliente

## Atualizacao de produto - 06/07/2026

### Concluir uma acao nao encerra o lead

Foi identificado um problema importante no fluxo atual: ao usar `Concluir` em um lead, o codigo muda o status para `pago`. Como a listagem esconde registros com status `pago` ou `perdido`, o lead desaparece da tela.

Isso nao representa corretamente o trabalho real. Exemplo: enviar uma mensagem ao cliente conclui apenas aquela acao. Se o cliente ainda nao respondeu, o relacionamento continua aberto e precisa de acompanhamento futuro.

Regra obrigatoria para qualquer IA que opere ou altere o app:

- concluir uma acao nao significa concluir o lead
- registrar a acao realizada no historico
- depois da conclusao, revisar o historico e definir o proximo passo
- se houver dependencia de resposta do cliente, manter o lead como `aguardando resposta` e definir uma data de revisao
- se for necessario novo contato, criar uma proxima acao com prazo
- o lead so deve sair do fluxo ativo quando estiver realmente finalizado, perdido, cancelado ou arquivado

Toda acao concluida deve terminar em exatamente um destes resultados:

1. proxima acao definida
2. aguardando resposta com prazo de revisao
3. lead encerrado de verdade, com motivo registrado

### Mudanca que ainda precisa ser implementada

Nao alterar automaticamente o lead para `pago` ao concluir uma atividade. Separar no codigo e na interface:

- `Concluir acao`: risca ou marca a atividade como feita, registra no historico e pede/gera o proximo passo
- `Encerrar lead`: acao separada, usada apenas quando o caso terminou de verdade

Enquanto essa alteracao nao for implementada, o Claude deve tratar o comportamento atual como uma limitacao conhecida, nao como regra desejada do produto.

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
- o app deve abrir pela entrada operacional antes do restante
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

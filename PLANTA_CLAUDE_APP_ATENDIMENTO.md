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

## Regras operacionais atuais — clientes, produção e financeiro

Estas regras devem ser preservadas por qualquer IA que opere ou altere o app:

- `Novo lead`, `Orçamento` e `Agendado` não geram lançamento financeiro.
- O valor informado nesses estados é somente o valor do orçamento.
- Ao mudar para `Produção`, confirmar a forma de pagamento antes de lançar valores.
- No acordo 50/50, registrar a entrada como paga e o saldo como `a_receber` na entrega.
- Entrada e saldo podem ter formas diferentes: Pix, dinheiro, transferência ou cartão.
- Em cartão, registrar o número de parcelas de cada parte separadamente.
- Cartão aprovado é tratado como pago para o controle operacional.
- Ao marcar o serviço como `Pago`, atualizar os lançamentos vinculados sem duplicá-los.
- Antes de criar um cliente, pesquisar o telefone para evitar ficha duplicada.
- Nunca excluir ficha, foto, serviço ou lançamento sem confirmação humana explícita.
- A IA deve resumir alterações de valor, pagamento, prazo e status ao terminar.
- Gerar orçamento transforma somente `Novo lead` em `Orçamento` e não cria financeiro.
- O orçamento deve ser revisado antes de imprimir, salvar ou compartilhar.
- Nunca enviar orçamento ou mensagem de WhatsApp automaticamente; aguardar confirmação humana.
- CNPJ, razão social e dados fiscais só podem aparecer após confirmação do dado atual.
- O editor guarda localmente CNPJ, WhatsApp e endereço usados no PDF para evitar redigitação.

### Orçamento profissional

A ficha do cliente possui a ação `Orçamento PDF`. Ela abre um editor com serviço,
descrição, medidas, materiais, valor, prazo, pagamento, validade, garantia,
observações e fotos. O documento pode ser impresso ou salvo como PDF pelo
navegador. O app também prepara a mensagem de acompanhamento para WhatsApp.

Ao gerar, o app salva valor e mensagem sugerida no serviço, registra o evento no
histórico e muda `Novo lead` para `Orçamento`. Ele não cria lançamento financeiro.

## Interface v4

A interface foi modernizada preservando a operação móvel:

- navegação inferior flutuante e rolável
- cards com hierarquia visual e feedback de interação
- cabeçalhos claros para Clientes, Leads, Agenda, Financeiro e Estoque
- formulários e modais com foco visual mais evidente
- layout responsivo em duas colunas em telas maiores
- linha do tempo clicável de `Novo lead` até `Pago`

A linha do tempo é uma ação real: ao tocar em uma etapa, ela usa o mesmo fluxo de
alteração de status e mantém as automações financeiras existentes.

### Exemplo de pagamento parcelado

Para um serviço de R$ 2.000 com metade agora e metade na entrega, ambas no cartão:

- entrada de R$ 1.000 — cartão 12x — `pago`
- saldo de R$ 1.000 — cartão 12x na entrega — `a_receber`

Quando a segunda transação for aprovada na entrega, o saldo passa para `pago`.

## Diálogos nativos removidos (08/07/2026)

O app usava `prompt()`/`confirm()` nativos do navegador em ~40 pontos (criar ficha,
editar cliente/serviço, encerrar lead, remover item, etc). Isso travava qualquer
automação de navegador (Claude/Codex operando via Chrome DevTools Protocol) — o
diálogo nativo bloqueia a página inteira e a automação trava esperando um clique
que nunca chega, sem erro claro.

Trocado por `askText(mensagem, valorPadrao)` e `askConfirm(mensagem)` — funções em
`index.html` que abrem um modal dentro da própria página (Promise-based, `await`).
Mesma UX pro Diego, mas agora clicável por automação e mais bonito no PWA que o
prompt cinza do sistema. **Qualquer IA que for adicionar uma nova pergunta/confirmação
ao app deve usar `askText`/`askConfirm`, nunca `prompt()`/`confirm()` nativos.**

## Fluxo "Aguardando você" — fichas incompletas (08/07/2026)

### O problema

A IA (Claude/Codex) processa a Caixa de Entrada e cria fichas/leads a partir de
notas curtas do Diego. Às vezes falta informação real pra decidir (ex: "é
presencial ou o cliente manda medida pelo WhatsApp?", "tem prazo combinado?").
Antes, a IA ou inventava uma resposta plausível (ruim: pode ficar errado) ou
perguntava no chat de conversa com o Diego (ruim: ele opera pelo celular e não
fica nessa conversa; o chat da sessão do Claude não é um canal de dia a dia).

### A decisão

O Diego opera 100% pelo app (celular). Então qualquer pergunta pendente da IA
tem que aparecer **dentro do app**, não numa conversa separada. O app é o ponto
de encontro assíncrono entre o Diego e a IA — ele joga coisas cruas na Caixa de
Entrada, a IA processa e devolve dúvidas ali, ele responde quando puder.

### Como funciona hoje (implementado)

- A ficha É criada mesmo com informação faltando — a IA nunca deixa de criar
  por falta de dado.
- Quando há uma dúvida real (não um detalhe cosmético), a IA grava em
  `proxima_acao` do serviço o texto: `❓ AGUARDANDO VOCÊ: <pergunta objetiva>`
  — usando o marcador `MARCADOR_AGUARDANDO` definido em `index.html`.
- A tela Início ganha uma seção **"🟠 Aguardando você"**, acima de "Precisa de
  atenção agora", listando todo serviço ativo cuja `proxima_acao` comece com
  esse marcador. Tocar no item abre a ficha do cliente direto.
- Tem também um card de resumo "Aguardando você" no topo da Início.
- Quando o Diego responde (edita a próxima ação da ficha removendo o `❓` e
  escrevendo o que decidiu), o item some sozinho da seção — não precisa de
  campo novo no banco, é só o prefixo do texto.
- **Não foi feita nenhuma alteração de schema no Supabase** — de propósito,
  pra não depender de rodar SQL manual no dashboard. Tudo roda em cima do
  campo `proxima_acao` que já existia.

### O que NÃO foi implementado (proposto e descartado por enquanto)

Chegou a se cogitar transformar a Caixa de Entrada num chat de verdade (bolhas
de mensagem, cor diferente pra IA e pro Diego, histórico da conversa). Decisão:
adiar. Primeiro rodar o fluxo simples (`❓ AGUARDANDO VOCÊ` na próxima ação) no
dia a dia real, ver que tipo de pergunta se repete (presencial/WhatsApp? prazo?
medida? valor?), e só then desenhar uma UI de chat se o padrão mostrar que vale
a pena. Não adivinhar o design agora.

### Regra pra qualquer IA operando o app

- Antes de inventar um dado que muda o resultado prático (endereço/medida real
  não importa tanto; **presencial vs. remoto, prazo prometido, valor combinado
  importam**), prefira marcar como "Aguardando você" a chutar.
- Não é para toda ficha ter uma pergunta — só quando a dúvida é real e o Diego
  precisa decidir. Ficha simples e completa não precisa de marcador nenhum.
- Ao processar a Caixa de Entrada numa sessão futura, sempre checar a seção
  "Aguardando você" primeiro: se o Diego já respondeu (a próxima ação não tem
  mais o `❓`), está resolvido; se ainda tem `❓`, ainda está esperando.
- **"Aguardando você" só existe dentro de uma ficha (`proxima_acao` de um
  `servico`).** Se o item da Caixa de Entrada não é sobre cliente/serviço —
  ex: nota administrativa tipo "conta da Vivo, ver duplicidade" — não force
  a criação de uma ficha só pra caber a pergunta.
- **Antes de perguntar qualquer coisa (aqui ou como "Aguardando você"), a IA
  tem que primeiro tentar resolver sozinha olhando o que já existe no app**
  (Financeiro, Clientes, Leads, Agenda, Estoque). Só vira pergunta se, depois
  de checar, a informação realmente não está lá. Errado (aconteceu em
  08/07/2026): a nota da Caixa de Entrada dizia "conta da Vivo com
  duplicidade, pode excluir uma" — a IA perguntou ao Diego em vez de abrir o
  Financeiro primeiro; ao checar depois, viu que já estava tudo consolidado
  num lançamento só, nada pra excluir. A pergunta era desnecessária.
- Se, mesmo depois de checar o app, a dúvida for real e o item não é sobre
  cliente/serviço (não tem onde anexar o `❓`), **deixe o item parado na
  Caixa de Entrada** (não processar, não apagar) até o Diego resolver
  sozinho ou dar mais contexto. Se a dúvida for sobre um cliente/serviço,
  use "Aguardando você" na ficha em vez de perguntar no chat de conversa.

# Grok: como gravar no app

Escrito pelo Claude em 25/10/2026, a pedido do Grok, com o ok do Diego, e atualizado no mesmo dia (Manu pausada 11h24, propostas novas suspensas). Vale junto com o doc 07 (App: links e tabelas).

**Desde 26/10/2026 quem faz o dia a dia é a Toqi.** Tudo aqui vale pra ela, trocando `grok` por `toqi` em `por` (historico) e em `origem` (cartões), e "Grok: " por "Toqi: " no começo do `o_que`. Código do app e estrutura do banco ficam com o Claude: ideia de tela vira recado no Mural.

## Mural de recados (mural_recados)

Recado entre Claude, Toqi e Diego, na aba Mural do app (`nova.html?ir=mural`). Ao entrar, leia os recados pra você e marque como lido.

```sql
select id, de, texto, criado_em from mural_recados where para in ('toqi', 'todos') and lido_em is null order by criado_em
```

```sql
update mural_recados set lido_em = now(), lido_por = 'toqi' where id = '<id>' and lido_em is null returning id
```

```sql
insert into mural_recados (de, para, texto, responde_a) values ('toqi', 'claude', 'Recado curto, sem ponto e vírgula', null) returning id
``` Banco: Supabase, projeto `iymlzdcloaeyybhefywp`. O código do app continua com o Claude.

## Regras de toda escrita

1. **SELECT antes**, pra não duplicar (cartão aberto do mesmo cliente, mesmo texto).
2. **Uma instrução por chamada**, curta.
3. **SELECT depois**, pra conferir o que ficou gravado.
4. **Uma linha no `historico`** a cada escrita, com `por = 'grok'`. `o_que` curto começando com "Grok: " (até 80 caracteres). `detalhe` nas palavras do Diego, com as referências `cliente <uuid> · servico <uuid> · agenda <uuid> · duvida <uuid>`.
5. **Nunca DELETE.** Card: `status = 'cancelado'` com o motivo. Cartão: `status = 'descartada'`. Proposta: `cancelada`.
6. **Nunca ponto e vírgula dentro de texto** no SQL (a instrução trava). Aspas simples dentro do texto: dobradas (`''`).
7. Valores no texto sem cifrão ("450 reais").
8. Gravação recusada ou travada: não tente outro caminho. Anote e tente de novo depois.

## Cartão de envio (Cartões pra você)

Campos que o app mostra:

| Campo | O que vai |
| --- | --- |
| `pergunta` | a pergunta ao Diego, com o nome do cliente ("Leandro: mando o follow-up?") |
| `contexto` | o porquê, o nome e o número com o link `wa.me/55DDDNUMERO` (é o número que o botão abre) |
| `texto_envio` | **o texto exato** que vai pro cliente. O app monta o link wa.me já com ele |
| `canal_envio` | `whatsapp_bahia` (o Grok manda pelo WhatsApp da empresa) ou `zapia_reserva` (recado à Zapia) |
| `opcoes` | os botões. Pra envio: `["Grok manda", "Eu mando", "Outro (escrevo)"]` |
| `plano` | o que acontece em cada opção (`{"Grok manda": "...", "Eu mando": "...", ...}`) |
| `cliente_id` | o uuid do cliente (dá o botão "Abrir ficha") |
| `origem` | `grok` (o cartão mostra "Grok") |

Quando o Diego toca "Grok manda" (ou "Mudar" e escreve), o cartão vira `status = 'respondida'` e o link `nova.html?ir=resposta&id=<id>` mostra **APROVADO PELO DIEGO · sai pelo WhatsApp Bahia · ainda NÃO enviada**, com nome, número, texto exato e o link wa.me. Depois do envio, grave `enviado_em`: o cartão passa a dizer "Enviada pelo WhatsApp Bahia em dia e hora".

### 1. Cliente parado: pergunta ao Diego

```sql
select id, status, pergunta from duvidas_agente where cliente_id = '<cliente uuid>' and status in ('aberta', 'respondida') order by criado_em desc
```

```sql
insert into duvidas_agente (pergunta, contexto, opcoes, plano, cliente_id, origem, canal_envio, texto_envio) values ('Leandro parado desde 21/10: mando o follow-up?', 'Orçamento enviado 21/10, sem resposta. Leandro +55 61 99999-0000, wa.me/5561999990000.', '["Grok manda", "Eu mando", "Outro (escrevo)"]'::jsonb, '{"Grok manda": "o Grok manda o texto exato pelo WhatsApp Bahia", "Eu mando": "nada sai pelo Grok", "Outro (escrevo)": "o Grok faz o que o Diego escrever"}'::jsonb, '<cliente uuid>', 'grok', 'whatsapp_bahia', 'Oi, Leandro! Conseguiu ver o orçamento?') returning id
```

```sql
insert into historico (o_que, por, detalhe) values ('Grok: perguntou ao Diego sobre o follow-up do Leandro', 'grok', 'cliente <uuid> · duvida <id>')
```

### 2. Follow-up proposto

Mesmo formato do item 1, com o texto do follow-up em `texto_envio`.

### 3. Aprovados esperando envio

```sql
select id, pergunta, texto_envio, contexto, cliente_id, respondido_em from duvidas_agente where status in ('respondida', 'aplicada') and enviado_em is null and resposta ~* '^(grok manda|manda|mudar)' and coalesce(canal_envio, 'whatsapp_bahia') = 'whatsapp_bahia' order by respondido_em
```

Se a resposta começa com "Mudar", o texto que vai é o que o Diego escreveu depois de " — " na `resposta`, palavra por palavra.

### 4. Resposta enviada (depois do ok do Diego e do envio)

```sql
update duvidas_agente set enviado_em = now(), canal_envio = 'whatsapp_bahia' where id = '<id>' and enviado_em is null and resposta ~* '^(grok manda|manda|mudar)' returning id, enviado_em
```

```sql
insert into historico (o_que, por, detalhe) values ('Grok: mandou o texto aprovado pro Leandro pelo WhatsApp Bahia', 'grok', 'cliente <uuid> · duvida <id>')
```

### 5. Fechar o cartão

A Manu está pausada desde 25/10: depois de fazer o que o Diego respondeu num cartão (mandou, esperou, cancelou), quem marca `aplicada` é você.

```sql
update duvidas_agente set status = 'aplicada', aplicado_em = now() where id = '<id>' and status = 'respondida' returning id, status
```

Limites do envio (doc 00, item 4): até 10 por dia, 2 minutos entre um e outro, das 8h às 20h, nunca domingo.

## Recados nos cards (agenda_recados)

Leia primeiro em toda rodada (era da Manu e da rotina Recados da agenda, pausadas em 25/10). O Diego toca Remarcar, Feito, Cancelar ou deixa um recado num card: faça o que ele pediu e feche o recado com uma frase do que você fez, ou com a pergunta ao Diego. O resultado aparece no card.

```sql
select r.id, r.acao, r.texto, a.id as agenda_id, a.titulo, a.data, a.hora from agenda_recados r join agenda a on a.id = r.agenda_id where r.processado_em is null order by r.criado_em
```

```sql
update agenda_recados set processado_em = now(), resultado = 'Remarcado pra ter 27/10 9h30.' where id = '<id>' and processado_em is null returning id
```

## O que o app não faz

- Não manda mensagem sozinho: o envio é do Grok, pelo WhatsApp Bahia.
- Não existe botão "montar por partes": o preço segue no tópico Regra de preço.
- Proposta nova está suspensa desde 24/10 (o Diego: "esse negócio de proposta de orçamento bagunça demais"): não crie proposta, o orçamento é montado com ele por partes (doc 02). Os botões das propostas antigas continuam no app: se ele tocar Aprovar numa delas, é o "manda" dele para aquele texto exato e o envio é seu, pelo WhatsApp Bahia (os textos dos botões ainda falam em Manu e Zapia).

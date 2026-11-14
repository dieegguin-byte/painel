# Painel da Tapeçaria Bahia — mapa pra quem mexe no código

Lido por qualquer sessão de IA antes de tocar neste repositório. É curto de propósito: diz onde as coisas
estão, quem escreve em cada tabela e as regras que não se discutem. O resto está nos comentários do código,
que são longos e explicam o porquê de cada decisão (não apague comentários pra "limpar").

## O que é

- App único: `nova.html` (≈14,6 mil linhas, React + JSX/TS compilado **no navegador** pelo Babel standalone).
  Servido pelo GitHub Pages em https://dieegguin-byte.github.io/painel/nova.html. PWA: `manifest.webmanifest`,
  `sw.js` (service worker), `socorro.html` (tela de socorro quando o app não abre), `icon-*.png`.
- Dados: Supabase, projeto `iymlzdcloaeyybhefywp` (URL e chave publicável estão no `nova.html`; a chave é
  pública de propósito, quem protege é a RLS). Edge function `edge-functions/push-enviar/index.ts` (push).
- `index.html` só redireciona pra `nova.html` (desde 02/11/2026). O app ANTIGO (v4, 16/09/2026, login próprio e
  botões de apagar) ficou guardado em `index-antigo.html`, fora do caminho. (`nova_teste.html`, sobra de julho, foi apagado em 02/11/2026 com o ok do Diego.)
  `estoque.html` é a tela de estoque. `testes.html` é um laboratório manual, não é CI.
- `agenda-caixa.js` é carregado pelo `nova.html` antes do fonte (identidade agenda × caixa).

## Publicar

- Publicar = fazer merge na `main` (o Pages serve a `main`). **Só com o "V" do Diego** no projeto. PR que
  toca dado de cliente pediu palavra explícita dele (caso do PR 197).
- Não existe build: o `nova.html` que está na `main` é o que o celular baixa. O Babel compila uma vez por
  versão e guarda em Cache Storage (`tb-babel-v1`, chave = SHA-256 do fonte); nada a fazer nisso. Desde 11/11/2026
  o Babel só é baixado quando há o que compilar, e a troca de versão do `sw.js` não apaga esse cache.
- O `sw.js` pede o `nova.html` com `cache: 'no-cache'` (o servidor responde 304 quando não mudou; versão nova
  entra na mesma abertura). Com cópia boa guardada, a rede tem 4 s pra responder; passou disso o app abre com a
  cópia e a versão nova fica pra abertura seguinte.
- Mudou `sw.js`? Suba `VERSAO` dentro dele e o `?v=` do `register('./sw.js?v=N')` no fim do `nova.html`.
  Só o `nova.html` registra o service worker. O `estoque.html` (que abre dentro do app) só registra quando não há
  nenhum: endereço diferente do do app troca o service worker e o app recarrega duas vezes (a aba Estoque não ficava
  aberta, 13/10 a 11/11/2026). Página nova no mesmo site: não registre outro `?v=`. O `?v=` do `estoque.html` anda
  junto com o do `nova.html` (`tests/avisos-agua-calada.test.cjs` confere).
- Link de aviso e atalho do ícone abrem `./nova.html?ir=...`. O `sw.js` guarda e procura a página pelo endereço sem o
  `?...` (uma cópia só, que serve pra qualquer link e abre sem sinal). O app continua lendo `location.search`.
- Aviso do celular: a função `push-enviar` decide quando o aviso sai e o `sw.js` decide se apita. A água sai de hora
  em hora, mas só o primeiro de cada série apita sempre (3h depois do copo, e na abertura das 08:00); a repetição
  leva `atualiza_calado` e o `sw.js` troca o texto calado enquanto o aviso que apitou está na barra (`data.tocou`).
  Mudou a função? O merge não publica função: sobe pelo Supabase (`deploy_edge_function`), também só com o V.
- Antes de abrir PR: compile o `nova.html` com o mesmo Babel e rode os testes (ver "Testes"). Tela preta já
  aconteceu duas vezes (22/08 e 02/09/2026) por erro de código publicado sem checar.

## Regras que não se discutem (vêm do Diego)

- **Cancelar, nunca apagar.** Nada de `delete` em serviço, cliente, agenda ou financeiro pelo app ou por
  sessão. `DELETE` só com "apaga agora" dito por ele naquele caso. Migração nunca é destrutiva.
- **Nunca `DROP`.** Coluna ou tabela errada: `ALTER` (renomear, marcar como legado) e conversa com ele.
- **Conserta o caminho, não remove o caminho.** Botão ou fluxo que ficou sem dono fica atrás de uma chave
  (ex.: `MANU_LIGADA`), o código fica.
- **SQL pelo MCP do Supabase: um comando por chamada, sem `;`.**
- **Dia e hora são decisão do Diego.** Nunca inventar hora; dia sem hora mantém a hora que o card já tinha.
  O banco exige hora em card planejado (`trg_agenda_planejado_exige_hora`).
- **Dinheiro, preço, Ads, site e funcionalidade nova: só com a palavra dele.** A Toqi nunca mexe em preço,
  dinheiro ou apaga nada (as políticas `toqi_*` já impedem; não as afrouxe).
- Telefone gravado no padrão `^55[1-9][0-9]9[0-9]{8}$` (DF/GO: 55 + 61 + 9 + 8 dígitos).
  Desde 03/11/2026 também vale número de fora do Brasil, gravado como `+<dígitos>`: começa com "+", país diferente
  de 55, 11 a 15 dígitos (`ehTelefoneInternacional` no app, `private.whatsapp_phone_ok` e a trava `clientes_telefone_whatsapp`
  no banco). Sem "+" continua sendo lido como celular brasileiro. A Caixa (`agenda_criar_da_caixa`) segue só com número BR.
- Texto de tela: português curto, sem "!", e o botão promete só o que acontece de verdade.
- Fuso: Brasília. `hojeISO()` usa o relógio do aparelho; as travas do banco usam `America/Sao_Paulo`.

## Quem escreve em cada tabela (03/11/2026)

| Tabela | Quem grava | Como |
| --- | --- | --- |
| `agenda` (cards) | Diego pelo app; Toqi (insert/update, nunca com `financeiro_id`); threads do Claude pelo MCP | políticas `operador_autorizado` + `toqi_le/insere/altera` |
| `agenda_recados` (toques nos cards) | só o app (Feito/Cancelar/recado) | só `operador_autorizado`: a Toqi não lê nem fecha |
| `clientes`, `servicos` | Diego pelo app; Toqi (serviço sem preço); threads | `toqi_*` travam preço |
| `historico` | app (`por='diego'`), threads e auditoria (`por='claude'`), Toqi (`por='toqi'`, prefixo "Toqi: ") | check de `por` |
| `financeiro`, `dividas`, `contas_saldo` | Diego pelo app; Balanço/threads só com a palavra dele | gatilhos `agenda_baixa_financeiro`, `financeiro_baixa_divida` |
| `mural_recados` | Claude (`de='claude'`), Toqi (`de='toqi'`, `para='claude'`, cota), Diego | `lido_por` só aceita claude/toqi/grok/diego |
| `pessoais` | app (card Pessoais e cards projetados); cron `pessoal-some-sozinho` | |
| `caixa_entrada`, `duvidas_agente`, `propostas` | app; eram lidas pela Manu (desligada em 02/11/2026) | hoje sem consumidor automático |
| `push_*` | app (inscrição), `push-enviar` e cron (`push-varredura` 5 min, `push-resumo` 10h30) | |
| `rotinas`, `agua`, `avisos_operacionais`, `estoque*`, `compras_*`, `fornecedores`, `profissionais` | app e threads | |

Logins: Diego (`usuarios_autorizados` → `usuario_autorizado()`) e Toqi (`usuarios_mural` → `usuario_mural()`).
Essas duas funções, `mural_toqi_cota_ok()` e `push_segurar_lembrete()` são chamadas pelas políticas e pelo app:
**nunca revogue o EXECUTE delas** (o app fica vazio). As políticas `operador_*` e `toqi_*` não são duplicatas:
a da Toqi é a trava dela. Não junte.

## Mapa do `nova.html`

Procure pelo nome (as linhas mudam). Ordem no arquivo:

1. `<style>` até ~1400: CSS. Blocos comentados por data e pedido do Diego. **Cor no CSS é sempre `var(--c-<hex>)`**
   (desde 14/11/2026): o `:root` das cores define cada uma com o próprio valor, e o tema "azul e dourado" troca os valores
   em `html[data-tema="marca"]` (escolha no menu "⋯", guardada em `localStorage` `tb-tema`, aplicada por um script no
   `<head>` antes de desenhar). Cor nova: escreva `var(--c-<hex>)`, ponha `--c-<hex>:#<hex>` no `:root` das cores e, se
   ela for marrom ou cobre, o valor azul ou dourado no bloco do tema. Fonte: `var(--fonte-titulo)` / `var(--fonte-texto)`
   (no tema da marca viram Bricolage Grotesque e Manrope, de `fonts/`). `tests/tema.test.cjs` confere;
2. `<script>` de boot: `TB.carregarTudo` (supabase, React, ReactDOM) e `TB.carregarBabel` (só quando o `montar()`
   vai compilar). Três tentativas por biblioteca: jsdelivr, jsdelivr furando o cache, unpkg.
3. `<script type="text/plain" id="app-source">`: o app. Dentro dele, nesta ordem:
   - constantes e helpers: `SUPABASE_URL`/`SUPABASE_KEY`, `PIN_LIGADO`, `compactDate`, `hojeISO`,
     `somarDias`, `DIAS_SEMANA`, demo data (`demoAppointments`…), `comConta`, `comTituloVisivel`,
     `pessoaisNaFila` (item pessoal projetado na fila);
   - `// ===== Cérebro de rota/agenda =====`, `// ===== CICLO DE COBRANÇA`, `// ===== MODALIDADE`
     (`ehRemoto`, `paradaFisica`), `// ===== PORTA ÚNICA DA OPERAÇÃO BAHIA` (`processarEventoOperacaoBahia`:
     toda gravação de serviço/financeiro passa por aqui);
   - `function Home()`: estado global, `loadAll` (baixa tudo: serviços, financeiro, clientes, agenda
     planejada, mural…), canal realtime `operacao-viva` (debounce 0,7 s → `loadAll({ deFora: true })`), cache
     offline em localStorage `tb-novo-cache-offline`, abas. `criarOrdemDeCargas` decide qual carga vale quando
     várias voltam fora de ordem (carga pedida antes do último toque do Diego não redesenha a tela);
   - cards da agenda: `useRecadosAgenda` (Feito/Cancelar/recado/Remarcar/Adiar 1h, Desfazer),
     `AcoesDoCompromisso` (botões do card), `CompromissoCard`, `FocoDoCard`/`FocoGlobal`, alarme
     (`AlarmeCompromisso`), avisos da barra (`fecharAvisosDeCards`, `conferirAvisosNoServidor`).
     `perguntaDoFeito` é a regra única do que o Feito pergunta antes de gravar ("Pagou?" na conta ligada, quanto e
     de onde saiu na compra): botão novo de Feito passa por ela, nunca grava direto;
   - `// ===== DOMÍNIO PESSOAIS` (`PessoaisCard`), `PropostasCard`, `RotinasCard`, `ContadorAgua`;
   - `// ===== A CAIXA VOLTA COMO FILA` (`CaixaCard`, `CaixaView`, `CaixaForm*`);
   - cards do Painel: `RetornosVencidosCard`, `CapacidadeCard`, `MateriaisCard`, `GrupoRecolhivel`,
     `AgenteCard` ("O que a Toqi fez", lê `historico`), `ResumoManhaCard`, `DuvidasAgenteCard`,
     `ManuCard` (grupo no fim do Painel), `MudancasDaManu` (cards com `nota_claude_conferida = false`);
   - `function Dashboard(`: o Painel (Atrasados / Hoje / Próximos, cobranças, pendências). O card "Agenda de hoje"
     fechado lista a hora e o nome do que ainda vem (`linhasDeHojeFechado`, `tests/hoje-fechado.test.cjs`);
   - `// ===== CALCULADORA RÁPIDA`, `LeadsView`, `AgendaView` + `AddAgendaModal` + `ConcluirModal` +
     `AgendaPicker` (dia e hora livres, igreja, almoço, estrada), `FinanceView` (+ `calcularSaldosPorConta`:
     "Em caixa" soma todo financeiro pago desde `contas_saldo.data_inicial`), `MuralView`,
     `ProfissionaisView`, `// ===== CONFIRMAÇÃO DE SERVIÇO` (PDF no aparelho), `ComprasView`,
     `ListaDeCompras`, `FuturoView`, `FornecedoresView`, `CustomersView`, `FichaModal`.
4. `<script>` final (`montar()`): se a cópia compilada desta versão está no cache (chave = hash do fonte), injeta
   e pronto, sem Babel; senão baixa o Babel, compila com `Babel.transform(presets: react classic + typescript)` e
   guarda. Cão de guarda de 20 s (`telaDeSocorro`), registro do service worker.

Fluxo de hoje (desde 02/11/2026): o Diego fala só com a Toqi no WhatsApp; ela escreve no Mural
(`PRA LANÇAR:` → `LANÇADO:`) e grava cards/fichas/serviços/histórico com o login dela. A Manu (rotina de hora
em hora) está desligada: nada lê `agenda_recados`, `caixa_entrada` nem `duvidas_agente` sozinho. A auditoria
das 02h20 (Claude) confere o dia.

## Banco: migrações e travas

- Pasta `migracoes/`: um arquivo por mudança, `AAAAMMDDHHMMSS_assunto.sql` (os mais velhos usam
  `AAAA-MM-DD_assunto.sql`). Regras em `migracoes/LEIA-ME.md`: idempotente (`if not exists`,
  `create or replace`, `drop policy if exists`), nunca destrutiva, termina com um `select` que confere.
  Aplicar pelo MCP do Supabase (`apply_migration`) ou SQL Editor, e anotar no LEIA-ME. `migracoes/rollback/`
  guarda o caminho de volta de algumas.
- Travas que você vai esbarrar: `trg_agenda_planejado_exige_hora` (card planejado precisa de hora),
  `trava_agenda_feito_no_futuro` (não dá pra marcar feito antes do dia, fuso de Brasília),
  `agenda_bloqueio_horario_unico` (presencial/pessoal: um só por `data+hora`; colisão = erro 23505),
  `agenda_sem_duplicata` (`servico_id+titulo+data`), `agenda_servico_exige_whatsapp`,
  `agenda_baixa_financeiro` (Feito em card com conta baixa a conta), `propostas_fecha_card`,
  `servicos.atualizado_em` sobe sozinho. Histórico delas em `TRAVAS_BANCO.sql` e `CICLO_COBRANCA.sql`.
- A API do Supabase devolve no máximo 1000 linhas por pedido e não avisa (volta 200; só o `Content-Range` conta).
  Tabela que cresce sem parar (`clientes`, `servicos`, `financeiro`, `pessoais`, agenda fora do planejado) é lida
  com `buscarTudo` (em páginas, ordem terminando em `id`). Consulta nova numa dessas tabelas: use `buscarTudo`
  (`tests/carga-sem-corte.test.cjs`). O `financeiro` passou de mil em 23/10/2026 e o app ficou sem julho até isto.
- Cron (pg_cron): `push-varredura` (*/5), `push-resumo` (10h30), `pessoal-some-sozinho` (*/15);
  `bahia-conferencia-pronto-v1` está desligado.
- Edge functions no Supabase: `push-enviar` (modos `varredura`, `resumo`, `chave`, `recibo`, `acao`,
  `validar`, `teste`: os três do meio não pedem segredo, são protegidos pelo uuid do recibo que só o aparelho
  tem), `zapia-lancar` (segredo), `marketing-track`; `zapia-ping` (morta, 410; o Diego deu ok pra apagar em 02/11/2026, sai pelo painel do Supabase) e `github-bridge` (legado).

## Testes

- Rodam com o Node 22, sem instalar nada: `node --test tests/atrasados-passou-da-hora.test.cjs
  tests/clientes-sem-nome.test.cjs tests/ordem-data-hora.test.cjs tests/pronto-producao.test.cjs
  tests/texto-pronto-foto.test.cjs tests/whatsapp-comum.test.mjs tests/abrir-sem-babel.test.cjs
  tests/sw-documento.test.cjs` (o `pronto-producao` pede
  `BAHIA_BABEL_PATH=<caminho>/@babel/standalone/babel.min.js`). Os dois últimos rodam o boot do `nova.html` e o
  `sw.js` num navegador de mentira: mexeu em `montar()`, `TB.carregar*`, no `fetch`/`activate` do `sw.js` ou no
  registro do service worker do `estoque.html`, rode.
- Precisam de `pnpm install` (pglite): `agenda-caixa-identidade`, `caixa-fila`, `card-pagamento-ligado`,
  `conferencia-monitor`, `engenharia-itens`.
- `cronograma-tecnico-ui` tem uma afirmação velha (o `CronogramaTecnico` não está mais montado no Painel):
  o teste nº 11 falha por isso, não por erro no app.
- Compilar o app inteiro: `BAHIA_BABEL_PATH=... node --test tests/nova-compila.test.cjs` (quando existir a
  checagem automática, é o que ela roda em todo PR).
- `tests/painel-consertos.test.cjs` (sem instalar nada): a pergunta do Feito, o aviso por cima das listas, o card
  aberto que não herda o painel do vizinho e a ordem das cargas. Mexeu em `BotaoAdiar1h`, `AcoesDoCompromisso`,
  `notify`, `FocoDoCard` ou `loadAll`, rode.
- Busca de Leads e Clientes: `buscaBate` (nome e serviço ignoram acento; termo só de números, 4 ou mais, compara os
  dígitos do telefone, só em Clientes). A cidade fica fora dele de propósito: sem acento, "Luzia" acharia quase a base
  inteira. Busca nova numa lista passa por ele (`tests/busca-acha.test.cjs`). Botão, caixa e lista da Manu na ficha
  ficam atrás de `MANU_LIGADA` (`tests/ficha-sem-manu.test.cjs`).
- `tests/avisos-envio-falha.test.cjs` (pede `BAHIA_BABEL_PATH`) roda a `push-enviar` inteira com banco e Google de
  mentira: um envio que estoura solta só a chave dele (se o soltar também falha, ela fica presa e os outros seguem), e
  a anotação do aparelho que falha não desfaz um envio aceito.
  Mexeu em `entregar` ou `difundir`, rode.

## Documentos do repositório

`LEIA-ME_PUBLICAR.md` descreve a v2 de julho (Gist) e está desatualizado; `PLANTA_CLAUDE_APP_ATENDIMENTO.md`
é histórico de produto (superado em 16/09/2026); `docs/` guarda notas de funcionalidades específicas.
Este arquivo é o que vale pra orientação; atualize-o quando mudar quem escreve onde ou uma regra.

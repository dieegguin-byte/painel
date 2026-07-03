# Painel de Atendimento (PWA) — como funciona e como publicar

Site/PWA de **leitura** do WhatsApp da Tapeçaria e Estofados Bahia. Mostra no
celular: resumo do dia, prazos/decisões, agenda, clientes que precisam de
atenção e resumo financeiro. **Nunca envia nada** — só mostra.

## Arquitetura (decidida com Diego em 03/07/2026 — opção B: GitHub Pages)

```
Claude (PC, à noite)  ->  escreve dados_atendimento.json (Write local, sem permissão)
                      ->  git add + commit + push   (ÚNICO comando aprovado 1 vez)
GitHub Pages          ->  serve o painel E o dados_atendimento.json (mesmo site)
PWA (celular)         ->  abre a URL, lê os dados (mesma origem, sem CORS), instala na tela
```

Por que GitHub Pages: 1 conta resolve hospedagem + dados; dados no mesmo site
(sem CORS, sem proxy, sem fragilidade do OneDrive); o git já está instalado no
PC. O OneDrive deixou de ser necessário para a leitura (o link de
"Compartilhar" do OneDrive consumidor não entrega o arquivo cru para um
programa — só abre a página de visualização; testado em 03/07).

## Arquivos

- `index.html` — o painel (PWA completa, funciona offline, um arquivo só).
- `manifest.webmanifest`, `sw.js`, `icon.svg`, `icon-maskable.svg` — PWA/instalação.
- `dados_atendimento.json` — os dados que o painel mostra (escritos pela rotina).
- `.nojekyll` — faz o GitHub Pages servir os arquivos como estão.

## Passos para publicar (uma vez, com o Diego presente)

[D] = só o Diego faz (conta/login). O resto o Claude conduz/executa.

1. **[D] Criar conta grátis no GitHub** (github.com) — e-mail + senha + verificar
   e-mail. (Se já tiver conta, é só usar.)
2. Claude transforma a pasta `app_atendimento` em repositório git e cria o
   repositório no GitHub.
3. **[D] Primeiro `git push`**: o Git abre uma janelinha do navegador pra você
   entrar no GitHub uma vez (Git Credential Manager). Depois disso fica salvo e
   os próximos pushes (inclusive os da rotina noturna) acontecem sozinhos.
4. Claude liga o **GitHub Pages** no repositório (Settings > Pages) — gera a URL
   pública `https://SEU-USUARIO.github.io/REPO/`.
5. **[D] No celular**: abrir a URL -> menu do navegador -> "Adicionar à tela inicial".
6. Testar: o painel abre, mostra os dados, o "Atualizar" funciona.

## O "1 comando aprovado" (item 4)

A rotina noturna, além de atualizar o `PENDENCIAS.md`, passa a:
1. escrever `dados_atendimento.json` na pasta do repositório (Write local);
2. rodar `git -C <pasta> add/commit/push` para publicar.

Esse `git push` é aprovado **uma vez** (fica salvo em `~/.claude/settings.json`)
e nunca mais pede confirmação — não depende do Diego estar presente de noite.

## Regras/observações

- A rotina só ADICIONA/atualiza o arquivo de dados; nunca mexe no resto do repo.
- Se o painel um dia parar de atualizar, checar: (a) o PC estava ligado/online de
  noite; (b) `git push` funcionou (credencial do GitHub ainda válida).

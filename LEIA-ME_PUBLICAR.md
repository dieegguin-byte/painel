# Painel de Atendimento (PWA) — v2, NO AR

URL: **https://dieegguin-byte.github.io/painel/** (adicionar à tela inicial do celular).

## Arquitetura real (como está funcionando)

```
Claude (PC, à noite) -> escreve dados_atendimento.json em ../app_dados_gist/ (Write local)
                     -> git add/commit/push no GIST SECRETO (permissão salva no settings.json)
GitHub Pages         -> serve o painel (repo público dieegguin-byte/painel, SEM dados de cliente)
Gist secreto         -> serve os dados (id e837448593fcd4fcea82096b942d93d4, CORS liberado)
Celular (PWA)        -> lê o Gist e mostra; Diego conclui/anota itens
Meu Vivo (WhatsApp)  -> os botões ✔/✏️ mandam comandos "PAINEL ..." pro Meu Vivo (compartilhar);
                        a varredura noturna (23h30) lê e dá baixa no sistema
```

## O que a v2 faz (05/07/2026)

- **✔ Concluir** qualquer item (cliente, alerta, agenda, financeiro pendente): some da
  lista na hora (fica salvo no aparelho) e abre o compartilhar com o texto
  `PAINEL ✔ Concluído: ...` para mandar ao "Meu Vivo" — a rotina noturna dá baixa.
- **✏️ Anotar/corrigir**: manda `PAINEL ✏️ item: ...` pro Meu Vivo do mesmo jeito.
- **Seção "Concluídos por você"** com Desfazer e reenvio (📤).
- **Filtros** (Todos / Alta / Com prazo) quando há mais de 1 cliente.
- **📞 Ligar** e **WhatsApp** direto do item.
- **Financeiro borrado por padrão** (👁 Mostrar valores) — privacidade se alguém pegar o celular.
- **Aviso de dados velhos**: banner se `atualizado_em` > 26h (rotina falhou/pausada); crítico > 50h.
- Service worker v2: página network-first (atualiza sozinha), offline continua funcionando.

## Limites conhecidos (honestos)

- Conclusões ficam **no aparelho** (localStorage) até a rotina noturna processar o
  comando no Meu Vivo. Trocou de celular/limpou o navegador = marcas locais somem
  (o sistema real continua certo, pois a baixa oficial é via rotina).
- O HTML público contém a URL do Gist: quem tiver o link do painel consegue ler os
  dados (Diego aceitou esse trade-off em 03/07). Upgrade possível: criptografar o
  JSON com PIN (WebCrypto) — fase futura.
- Edição em tempo real (mexer no dado e todo mundo ver na hora) exigiria backend
  (ex.: Supabase grátis) — é a ideia de v3, se o Diego quiser.

## Regras operacionais

- A rotina SEMPRE SOBRESCREVE `../app_dados_gist/dados_atendimento.json` (nunca
  apagar+recriar) e dá `git push origin HEAD` — permissões `Bash(git push:*)`,
  `git add`, `git commit` já salvas em `~/.claude/settings.json` (testadas 05/07).
- O repo público só recebe código do painel — NUNCA dados de cliente.
- Se o painel parar de atualizar: checar se o PC ficou ligado/online, se a rotina
  varredura (23h30) está ativa, e se o `git push` do gist funcionou.

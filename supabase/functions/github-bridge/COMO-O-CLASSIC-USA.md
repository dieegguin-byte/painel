# Ponte Classic → GitHub — manual de uso

Para o ChatGPT Classic (Manu). Este é o caminho para alterar código do app sem
possuir token do GitHub.

## Por que existe

O conector GitHub do ChatGPT lê o repositório, mas **não escreve**: toda tentativa
volta `403 Resource not accessible by integration` — criar branch, criar arquivo,
até abrir issue. Não adianta insistir nem procurar contorno nessa integração.

Então o Classic não escreve: **ele pede**. Grava uma linha numa fila do Supabase
(SQL, que funciona) e um executor server-side faz o trabalho:

```
Classic → github_change_requests → Edge Function github-bridge → branch → commit → PR
```

O token do GitHub nunca passa pelo ChatGPT.

## O pedido mínimo

```sql
insert into public.github_change_requests
  (idempotency_key, arquivos, commit_message, motivo)
values (
  'botao-whatsapp-2026-08-20',
  '[{"path": "docs/exemplo.md", "content": "conteúdo COMPLETO do arquivo"}]'::jsonb,
  'Ajusta o texto do botão de WhatsApp',
  'Diego pediu em 20/08: o botão dizia "Chamar" e confundia com ligação.'
)
returning id, status;
```

Pronto. O gatilho acorda o executor sozinho — não é preciso chamar mais nada.

### Campos

| Campo | Obrigatório | Observação |
|---|---|---|
| `idempotency_key` | **sim** | Único. É o que impede pedido repetido virar dois PRs. Use algo estável e descritivo: `assunto-data`. |
| `arquivos` | **sim** | Array JSON. Cada item: `{path, content}` e opcionalmente `expected_sha`. |
| `commit_message` | **sim** | Vira o título do commit e do PR. |
| `motivo` | **sim** | Por que a mudança existe. Entra no corpo do PR — é o que o Diego lê depois. |
| `repository` | não | Só aceita `dieegguin-byte/painel`. |
| `base_branch` | não | Padrão `main`. |
| `solicitado_por` | não | Padrão `classic`. Auditoria. |

### `content` é o arquivo inteiro

Não é patch, não é trecho. É o conteúdo final completo do arquivo. Leia o arquivo
atual pelo GitHub (leitura funciona), monte a versão nova inteira e mande.

### `expected_sha` — use quando o arquivo já existe

```json
[{"path": "nova.html", "content": "...", "expected_sha": "a1b2c3..."}]
```

É o blob SHA que o GitHub devolve ao ler o arquivo. Se alguém tiver mexido no
arquivo entre a leitura e o pedido, o executor **recusa** em vez de sobrescrever
por cima da mudança nova. Sem `expected_sha`, o pedido sobrescreve sem perguntar.

Para editar `nova.html`, sempre mande `expected_sha`.

## Consultar o resultado

```sql
select status, branch, pr_url, pr_number, commit_sha, erro, processado_em
from public.github_change_requests
where idempotency_key = 'botao-whatsapp-2026-08-20';
```

| `status` | Significa |
|---|---|
| `pendente` | Enfileirado, executor ainda não pegou. |
| `processando` | Em execução agora. |
| `concluido` | PR aberto. `pr_url` tem o link. |
| `erro` | Não deu. `erro` explica. |

Leva alguns segundos. Se ficar `pendente` por mais de um minuto, o gatilho não
disparou — ver *Quando emperra*.

## O que a ponte NÃO faz

- **Não escreve na main.** A branch de saída é sempre `classic/…`, garantido por
  constraint no banco, não só por código.
- **Não faz merge.** O PR fica esperando o Diego. Sempre.
- **Não apaga arquivo.** Só cria e atualiza.
- **Não sai do repositório `dieegguin-byte/painel`.**
- **Não toca em `.github/workflows/` nem `.git/`.**
- **Não executa comando nenhum** vindo do pedido.

## Limites

- 20 arquivos por pedido
- 1,5 MB por arquivo (o `nova.html`, ~470 KB, cabe folgado)
- 3 MB no total por pedido

## Depois que o PR abrir

Confira o diff pelo GitHub em modo leitura e informe o Diego com o link. O merge
é decisão dele.

## Quando emperra

**Ficou `pendente` e não anda.** O gatilho não conseguiu chamar o executor.
Force a drenagem:

```sql
select net.http_post(
  url     := (select decrypted_secret from vault.decrypted_secrets where name = 'GITHUB_BRIDGE_URL'),
  headers := jsonb_build_object(
               'Content-Type', 'application/json',
               'x-bridge-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'GITHUB_BRIDGE_SECRET')
             ),
  body    := jsonb_build_object('action', 'drain')
);
```

**Deu `erro`.** Leia a coluna `erro`. Os comuns:

- `mudou em main desde que o pedido foi montado` — releia o arquivo, monte de
  novo com o `expected_sha` atual, abra pedido novo com chave nova.
- `GITHUB_TOKEN não configurado` — o Diego precisa repor o token nos Secrets.
- `a branch já existe mas não tem PR` — sobrou lixo de uma execução parcial;
  conferir à mão no GitHub.

Um pedido em `erro` pode ser reprocessado (drenar de novo). Um pedido
`concluido` é imutável — para mudar de ideia, abra um pedido novo.

## Recado sobre `nova.html`

É o app inteiro num arquivo só, e é o que o Diego usa no celular o dia todo.
Alteração ali: sempre com `expected_sha`, sempre revisada no diff antes do merge.
Se a mudança for grande ou estrutural, é conversa com o Claude, não pedido pela
ponte.

# Ponte Classic -> GitHub

Este arquivo foi criado pela propria ponte, em 20/08/2026, como teste de ponta a ponta.

O ChatGPT Classic nao consegue escrever no GitHub: o conector dele responde
403 "Resource not accessible by integration" para criar branch, criar arquivo
e ate para abrir issue. Entao ele nao escreve -- ele pede.

O caminho e este:

    Classic -> github_change_requests (Supabase) -> Edge Function github-bridge -> branch -> commit -> Pull Request

O token do GitHub vive apenas nos Secrets da Edge Function. Ele nunca passa
pelo ChatGPT, pelo navegador, pelo nova.html nem pelo Drive.

O manual de uso esta em supabase/functions/github-bridge/COMO-O-CLASSIC-USA.md
e as travas do banco em migracoes/2026-08-20_ponte_classic_github.sql.

Merge continua sendo decisao do Diego, sempre.

-- ============================================================================
-- MIGRAÇÃO 2026-08-22 — caixa_entrada.conversa é SEMPRE uma lista
--
-- POR QUE EXISTE: em 22/08/2026 o app abriu, mostrou tudo e apagou — tela preta
-- muda no celular do Diego. A causa foi UMA linha da caixa_entrada, gravada às
-- 17:41 por fora do app, com `conversa` trazendo um OBJETO
-- ({tipo, origem, documento_drive}) no lugar da lista de mensagens.
--
-- O app lê esse campo em vinte lugares com `(item.conversa || [])`. Isso não
-- protege de objeto: em JavaScript objeto é "verdadeiro", então o `|| []` não
-- entra e o `.filter` estoura no meio do desenho. Quando um componente estoura,
-- o React desmonta a árvore inteira — e num app de fundo escuro isso não é uma
-- mensagem de erro, é uma tela preta sem nada pra ler nem pra clicar.
--
-- O app já foi corrigido (comoLista + barreira de erro), mas o app não é o único
-- que lê essa tabela, e quem grava aqui não é só o app: o Classic e as rotinas
-- também escrevem. Corrigir só no cliente deixaria a mina no banco.
--
-- NORMALIZA, NÃO REJEITA. Um CHECK seria mais curto, mas recusaria a gravação —
-- e uma anotação recusada é uma anotação PERDIDA, sem ninguém pra ver o erro do
-- outro lado. Aqui o conteúdo é preservado: vira uma mensagem do sistema, com o
-- JSON original legível dentro dela, exatamente como o app faz na tela.
-- Mesma regra do resto do projeto: o sistema avisa, não bloqueia.
-- ============================================================================

create or replace function public.normaliza_conversa_caixa_entrada()
returns trigger
language plpgsql
as $$
begin
  -- null continua null: o app trata com `|| []` e não quebra. O problema é só
  -- o que existe mas não é lista (objeto, texto, número).
  if new.conversa is not null and jsonb_typeof(new.conversa) <> 'array' then
    new.conversa := jsonb_build_array(jsonb_build_object(
      'de', 'sistema',
      'texto', 'Anotação recebida fora do formato de conversa: ' || (new.conversa #>> '{}'),
      'em', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normaliza_conversa on public.caixa_entrada;

create trigger trg_normaliza_conversa
before insert or update on public.caixa_entrada
for each row execute function public.normaliza_conversa_caixa_entrada();

-- Conferência (deve voltar só 'array' e, no máximo, null):
--   select jsonb_typeof(conversa), count(*) from caixa_entrada group by 1;


# Operação Bahia V4 — Fase 1: leitura sombra

**Estado:** projeto técnico, não produção.  
**Regra P0:** esta fase pode observar fatos reais, mas não pode alterar nenhum fato real.

## Objetivo

Permitir que a V4 construa sua própria leitura da operação usando as fontes atuais e compare essa leitura com o comportamento da V3/Classic. O objetivo não é “substituir” nada ainda; é provar que a V4 entende corretamente o estado operacional antes de receber permissão de escrita.

## Fontes permitidas em modo leitura

### Supabase — fatos vivos

A primeira leitura deve usar somente estruturas já existentes e estáveis:

- `clientes`
- `servicos`
- `agenda`
- `financeiro`
- `fornecedores`
- `fotos`
- `dividas`
- `historico`
- `marketing_atribuicoes`
- `rotinas`
- `config`

`caixa_entrada` pode ser lida apenas como legado para reconciliação durante a migração. Ela não deve voltar a aparecer como módulo ou conceito de trabalho da V4.

`estoque` não vira eixo da V4 nesta fase. A estrutura existe, mas não há justificativa operacional para promover um módulo vazio enquanto materiais já participam de serviços/compras.

### Google Calendar — espelho

Pode ser consultado apenas para detectar divergência entre agenda oficial no Supabase e o espelho externo.

A V4 nunca deve concluir que um compromisso existe apenas porque existe no Calendar quando o fato operacional correspondente não está claro.

### Biblioteca + Skills — regras

Continuam sendo a fonte das regras operacionais. A V4 não “aprende” regra permanente observando coincidências nos dados.

### Windsor — marketing

Na primeira leitura sombra, Windsor é somente leitura e somente no módulo Crescimento. Nenhuma alteração de orçamento, campanha, grupo, anúncio, palavra-chave ou status é permitida.

## Proibições técnicas da Fase 1

- nenhum `insert`, `update`, `delete` ou RPC mutável no Supabase;
- nenhuma Edge Function operacional de escrita;
- nenhuma criação/edição/exclusão de evento no Calendar;
- nenhuma ação de escrita no Windsor;
- nenhum merge/publicação automática no GitHub;
- nenhuma chave privilegiada no frontend;
- nenhuma `service_role` no navegador;
- nenhuma mudança em `nova.html`;
- nenhuma migration no banco de produção;
- nenhuma alteração das tarefas 06:00 / 23:00 / 23:30 / 23:55.

## Projeções da V4

A V4 deve transformar fatos existentes em projeções de leitura, sem persistir resultado inicialmente.

### Hoje

Derivar:

- próximos compromissos;
- bloqueios de produção;
- retornos comerciais vencidos/próximos;
- entregas/retiradas relevantes;
- exceções que realmente exigem Diego;
- saúde de automações e integrações.

### Clientes

Um cliente deve aparecer uma vez, com timeline agregada de contatos/serviços. “Lead” é estado/visão e não entidade paralela.

### Serviços

Projeção por ciclo:

`orçamento -> fechado -> material -> produção -> entrega -> encerrado`

A V4 deve apontar quando dados atuais não permitem determinar uma etapa com segurança, em vez de inventar.

### Agenda

Toda entrada deve ser classificada quando possível como:

- confirmado;
- provisório;
- sugestão interna.

Se a origem não permitir distinguir, mostrar `estado_indeterminado` como divergência, não promover automaticamente para confirmado.

### Compras

Agrupar materiais/necessidades por serviço, fornecedor e estado operacional:

- planejado;
- comprar;
- em trânsito;
- em mãos;
- consumido/encerrado quando houver evidência.

### Financeiro

Separar no mínimo:

- entrada vs saída;
- empresa vs pró-labore/pessoal;
- recebido/pago vs previsto/a receber/a pagar;
- vínculo com serviço quando existente.

Status comercial de serviço não pode ser tratado como receita recebida.

### Crescimento

Conectar somente evidência real de atribuição:

`investimento -> aquisição -> contato -> orçamento -> fechamento -> receita recebida -> margem`

Sem marcador técnico ou confirmação explícita, origem fica `não atribuída`.

## Motor de comparação

Para cada projeção relevante, produzir conceitualmente:

```text
shadow_result
- dominio
- entidade_id
- calculado_v4
- referencia_atual
- resultado: igual | divergente | insuficiente
- motivo
- evidencias
- calculado_em
```

Nesta fase, `shadow_result` pode existir apenas em memória/log de laboratório. Não criar tabela em produção sem autorização posterior.

## Divergências P0

Tratar como P0 qualquer caso em que a V4:

1. considere fechado um serviço não fechado;
2. transforme sugestão em compromisso confirmado;
3. atribua pagamento ao serviço errado;
4. marque receita como recebida sem fato financeiro;
5. libere produção sem material quando o fluxo exige material;
6. perca cidade/cliente/telefone necessário para operação;
7. atribua campanha sem evidência;
8. esconda uma decisão humana necessária;
9. duplique cliente, serviço, evento ou lançamento;
10. discorde de operação composta já validada sem evidência de que a regra antiga estava errada.

## Readback e observabilidade

Mesmo em leitura, cada ciclo sombra precisa registrar no laboratório:

- hora da leitura;
- fontes consultadas;
- quantidade de entidades lidas;
- erros/parciais;
- divergências encontradas;
- versão do código V4 que calculou o resultado.

Falha silenciosa é falha P0.

## Critério para sair da Fase 1

Só avançar para backend/sandbox quando a V4 conseguir, por uma janela operacional representativa:

- ler os domínios sem alterar produção;
- manter zero escrita acidental;
- explicar divergências;
- não inventar fatos;
- manter agenda e financeiro semanticamente corretos;
- identificar exceções humanas sem recriar uma Caixa;
- apresentar resultado útil no celular.

A habilitação de escrita será domínio por domínio e exigirá autorização explícita posterior.

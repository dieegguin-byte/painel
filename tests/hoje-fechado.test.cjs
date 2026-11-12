// AGENDA DE HOJE FECHADA DIZ O QUE TEM (11/11/2026).
// O card "Agenda de hoje" fechado só contava ("1 compromisso(s) hoje · 1 rotina(s)"); agora lista a hora e o nome do
// que ainda vem, e tocar nas linhas abre o card. Nomes e horas daqui são inventados.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../nova.html'), 'utf8');
const source = html.match(/<script type="text\/plain" id="app-source">([\s\S]*?)<\/script>/)[1];
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

const inicio = source.indexOf('const HOJE_FECHADO_MAX');
const fim = source.indexOf('function quandoFalado(', inicio);
assert.ok(inicio >= 0 && fim > inicio, 'linhasDeHojeFechado deve vir logo antes de quandoFalado');
const ctx = vm.createContext({});
vm.runInContext(source.slice(inicio, fim) + '\n;globalThis.MAX = HOJE_FECHADO_MAX;', ctx);
const linhas = (...args) => Array.from(ctx.linhasDeHojeFechado(...args), (l) => ({ ...l }));
const textos = (...args) => linhas(...args).map((l) => l.texto);

const card = (hora, titulo, outros = {}) => ({ hora, titulo, ...outros });
const rotina = (hora, titulo) => ({ r: { hora, titulo } });
const semNome = () => '';

test('sem nada pra hoje não devolve linha nenhuma (o card fechado fica como era)', () => {
  assert.deepEqual(textos([], [], semNome), []);
  assert.deepEqual(textos(null, undefined, semNome), []);
  assert.deepEqual(textos(undefined, null), []);
});

test('cada linha começa pela hora, em HH:MM, e diz o título do card', () => {
  assert.deepEqual(textos([card('14:30:00', 'Entrega do sofá')], [], semNome), ['14:30 Entrega do sofá']);
  assert.deepEqual(textos([card('09:00', 'Visita de orçamento')], [], semNome), ['09:00 Visita de orçamento']);
});

test('compromissos e rotinas entram juntos, na ordem da hora; a rotina leva a marca 🔁', () => {
  const r = linhas(
    [card('14:00:00', 'Entrega do sofá'), card('09:00:00', 'Buscar espuma')],
    [rotina('10:30:00', 'Conferir caixa'), rotina('08:00:00', 'Ler Provérbios')],
    semNome,
  );
  assert.deepEqual(r.map((l) => l.texto), ['🔁 08:00 Ler Provérbios', '09:00 Buscar espuma', '🔁 10:30 Conferir caixa', '14:00 Entrega do sofá']);
  assert.deepEqual(r.map((l) => l.rotina), [true, false, true, false]);
});

test('na mesma hora o compromisso vem antes da rotina; sem hora vai pro fim, sem inventar hora', () => {
  const r = textos(
    [card(null, 'Ligar pro fornecedor'), card('10:00:00', 'Entrega')],
    [rotina('10:00:00', 'Beber água'), rotina(null, 'Arrumar a bancada')],
    semNome,
  );
  assert.deepEqual(r, ['10:00 Entrega', '🔁 10:00 Beber água', 'Ligar pro fornecedor', '🔁 Arrumar a bancada']);
});

test('o primeiro nome do cliente entra só quando o título não diz quem é, e entra na frente', () => {
  const nomeDe = (a) => a.cliente;
  assert.deepEqual(textos([card('15:00', 'Entrega do sofá', { cliente: 'Fulana de Tal' })], [], nomeDe), ['15:00 Fulana · Entrega do sofá']);
  assert.deepEqual(textos([card('15:00', 'Entrega da FULANA', { cliente: 'Fulana de Tal' })], [], nomeDe), ['15:00 Entrega da FULANA']);
  // Acento não conta: o título escreve "Natália" e a ficha "Natalia" (ou o contrário), o nome não repete.
  assert.deepEqual(textos([card('15:00', 'Consertar a cadeira — Natália', { cliente: 'Natalia Souza' })], [], nomeDe), ['15:00 Consertar a cadeira — Natália']);
  assert.deepEqual(textos([card('15:00', 'Consertar a cadeira da Natalia', { cliente: 'Natália Souza' })], [], nomeDe), ['15:00 Consertar a cadeira da Natalia']);
  // Título comprido: a linha corta no fim, então o nome tem que estar no começo pra não sumir atrás do "…".
  const comprido = 'Entregar o restante do sofá e receber o saldo combinado, levar a nota e conferir os pés';
  const [linha] = textos([card('09:00', comprido, { cliente: 'Beltrana Silva' })], [], nomeDe);
  assert.equal(linha, `09:00 Beltrana · ${comprido}`);
  assert.ok(linha.indexOf('Beltrana') < 10, 'o nome vem logo depois da hora');
  assert.deepEqual(textos([card('15:00', '', { cliente: '  Beltrano  Silva ' })], [], nomeDe), ['15:00 Beltrano']);
  assert.deepEqual(textos([card('15:00', '   ', {})], [], nomeDe), ['15:00 Compromisso']);
  // Sem a função de nome (ou com ela devolvendo vazio) fica só o título.
  assert.deepEqual(textos([card('15:00', 'Entrega do sofá', { cliente: 'Fulana' })], []), ['15:00 Entrega do sofá']);
});

test('o título visível (do registro pessoal ligado) vale mais que o título cru do card', () => {
  assert.deepEqual(textos([card('11:00', 'Bloqueio', { titulo_visivel: 'Consulta no posto' })], [], semNome), ['11:00 Consulta no posto']);
});

test('rotina sem título não deixa linha vazia', () => {
  assert.deepEqual(textos([], [rotina('07:00', '')], semNome), ['🔁 07:00 Rotina']);
});

test(`passou de ${ctx.MAX} linhas, o resto vira "e mais N" e a conta fecha`, () => {
  assert.equal(ctx.MAX, 4, 'o teto do card fechado é 4 linhas (mais que isso o Painel volta a rolar demais)');
  const cards = ['08:00', '09:00', '10:00', '11:00', '12:00'].map((h, i) => card(h, `Card ${i + 1}`));
  const comUmaRotina = linhas(cards, [rotina('08:30', 'Rotina do meio')], semNome);
  assert.deepEqual(comUmaRotina.map((l) => l.texto), ['08:00 Card 1', '🔁 08:30 Rotina do meio', '09:00 Card 2', '10:00 Card 3', 'e mais 2']);
  assert.equal(comUmaRotina.at(-1).mais, true);
  assert.equal(comUmaRotina.filter((l) => l.mais).length, 1);
  // Exatamente no teto não aparece "e mais".
  const noTeto = linhas(cards.slice(0, 4), [], semNome);
  assert.equal(noTeto.length, 4);
  assert.ok(noTeto.every((l) => !l.mais));
  // Um a mais que o teto: 4 linhas + "e mais 1".
  assert.equal(textos(cards, [], semNome).at(-1), 'e mais 1');
});

test('o card "Agenda de hoje" mostra essas linhas fechado e tocar nelas abre o card', () => {
  const pedaco = source.slice(source.indexOf('<CardRecolhivel id="secao-hoje"'));
  const abertura = pedaco.slice(0, pedaco.indexOf('cabecalho='));
  assert.match(abertura, /\bresumoAbre\b/, 'secao-hoje deve passar resumoAbre');
  assert.match(abertura, /resumo=\{hojeFechado\.length > 0 \?/, 'sem linha nenhuma o resumo é null (o card fica como era)');
  assert.match(abertura, /className="hoje-linhas"/);
  assert.match(source, /const hojeFechado = linhasDeHojeFechado\(hoje, rotinasHojeNoPrazo,/, 'as linhas saem das mesmas listas que o número do cabeçalho conta');

  const recolhivel = source.slice(source.indexOf('function CardRecolhivel('), source.indexOf('function CardRecolhivel(') + 3500);
  assert.match(recolhivel, /resumoAbre = false/, 'os outros cards recolhíveis não mudam: o resumo deles segue só texto');
  assert.match(recolhivel, /\{resumoAbre && resumo \? <button type="button" className="card-resumo-toque" onClick=\{abrir\}>\{resumo\}<\/button> : resumo\}/);
  // Só o card de hoje usa a novidade.
  assert.equal(source.split('resumoAbre').length - 1, 4, 'resumoAbre: parâmetro, comentário, uso no CardRecolhivel e o card de hoje');
});

test('cada linha do card fechado ocupa uma linha só, com "…" no fim se não couber', () => {
  const regra = css.match(/\.hoje-linha\{([^}]*)\}/);
  assert.ok(regra, 'falta a regra .hoje-linha');
  assert.match(regra[1], /white-space:nowrap/);
  assert.match(regra[1], /text-overflow:ellipsis/);
  assert.match(regra[1], /overflow:hidden/);
  const toque = css.match(/\.card-resumo-toque\{([^}]*)\}/);
  assert.ok(toque, 'falta a regra .card-resumo-toque');
  assert.match(toque[1], /width:100%/);
  assert.match(toque[1], /text-align:left/);
});

// PLURAL DE VERDADE NOS TÍTULOS DO PAINEL: "1 compromisso(s) hoje · 1 rotina(s)" era o texto de toda abertura.
test('os cabeçalhos dos cards do Painel dizem "1 compromisso" e "3 compromissos", sem "(s)"', () => {
  assert.equal(ctx.quantos(1, 'compromisso', 'compromissos'), '1 compromisso');
  assert.equal(ctx.quantos(3, 'compromisso', 'compromissos'), '3 compromissos');
  assert.equal(ctx.quantos(0, 'rotina', 'rotinas'), '0 rotinas');
  assert.equal(ctx.quantos('1', 'dia', 'dias'), '1 dia');
  const painel = source.slice(source.indexOf('function Dashboard('), source.indexOf('// ===== CALCULADORA RÁPIDA'));
  // Precisa resolver, Agenda de hoje, Próximos compromissos (este não tem id) e Revisão antiga.
  for (const marca of ['id="secao-vencendo"', 'id="secao-hoje"', '>PRÓXIMOS COMPROMISSOS<', 'id="secao-revisao-antiga"']) {
    const i = painel.indexOf(marca);
    assert.ok(i >= 0, `falta o card ${marca}`);
    const doCabecalho = painel.lastIndexOf('cabecalho=', i) > painel.lastIndexOf('<CardRecolhivel', i) ? painel.lastIndexOf('cabecalho=', i) : painel.indexOf('cabecalho=', i);
    const cabecalho = painel.slice(doCabecalho, painel.indexOf('}>', doCabecalho));
    assert.ok(cabecalho.length > 40, `cabeçalho de ${marca} não achado`);
    assert.doesNotMatch(cabecalho, /\(s\)/, `o cabeçalho de ${marca} ainda tem "(s)"`);
  }
  assert.match(painel, /quantos\(hoje\.length, "compromisso", "compromissos"\)\} hoje/);
  assert.match(painel, /futuros\.length === 1 \? "1 próximo compromisso" : `\$\{futuros\.length\} próximos compromissos`/);
  assert.match(source, /quantos\(pendentes\.length, "rotina", "rotinas"\)\} pra hoje/);
});

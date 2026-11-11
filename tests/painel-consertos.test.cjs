// CONSERTOS DO PAINEL (11/11/2026). Quatro defeitos do caminho de todo dia, medidos antes de consertar:
//   1. o Feito rápido da lista dava a conta ligada como paga sem perguntar "Pagou?" (regra de 18/10) e fechava o card
//      de compra sem perguntar quanto e de onde saiu (regra de 19/10);
//   2. o aviso ("Não salvou", "Escolha outra hora") era desenhado ATRÁS de qualquer lista ou card aberto;
//   3. no card aberto, deslizar pro card do lado levava junto o painel do anterior (o Remarcar gravava a hora dele);
//   4. um card recém-resolvido voltava pra tela quando uma carga pedida antes do toque chegava depois dele.
// Aqui ficam a regra da pergunta e a ordem das cargas (funções puras, tiradas do fonte e rodadas de verdade) e a
// conferência de que cada ponto do app está ligado nelas.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../nova.html'), 'utf8');
const source = html.match(/<script type="text\/plain" id="app-source">([\s\S]*?)<\/script>/)[1];
const css = html.slice(0, html.indexOf('<script type="text/plain" id="app-source">'));
const linha = (inicio) => {
  const i = source.indexOf(inicio);
  assert.ok(i >= 0, inicio);
  return source.slice(i, source.indexOf('\n', i));
};
const funcao = (nome) => {
  const i = source.indexOf(`function ${nome}(`);
  assert.ok(i >= 0, nome);
  return source.slice(i, source.indexOf('\n}\n', i) + 2);
};
const ctx = vm.createContext({});
vm.runInContext([
  linha('const RE_CARD_DE_COMPRA ='), linha('function ehCardDeCompra('), funcao('perguntaDoFeito'), funcao('criarOrdemDeCargas'),
  'this.pergunta = perguntaDoFeito; this.novaOrdem = criarOrdemDeCargas;',
].join('\n'), ctx);

// ---------- 1. O que o Feito pergunta antes de gravar ----------

test('card ligado a conta aberta pergunta "Pagou?" (a pagar) ou "Recebeu?" (a receber)', () => {
  assert.equal(ctx.pergunta({ titulo: 'Pagar a conta de água', financeiro_id: 'f1', conta: { status: 'a_pagar', valor: 120.5 } }, false), 'conta');
  assert.equal(ctx.pergunta({ titulo: 'Cobrar a entrada do sofá', financeiro_id: 'f2', conta: { status: 'a_receber', valor: 500 } }, false), 'conta');
  // a conta ainda não chegou junto com o card (carga pela metade): na dúvida, pergunta
  assert.equal(ctx.pergunta({ titulo: 'Pagar o boleto', financeiro_id: 'f3' }, false), 'conta');
});

test('card ligado a conta que já está paga não pergunta de novo', () => {
  assert.equal(ctx.pergunta({ titulo: 'Pagar o boleto', financeiro_id: 'f1', conta: { status: 'pago' } }, false), null);
});

test('card de compra sem conta ligada pergunta quanto pagou e de onde saiu', () => {
  for (const titulo of ['Comprar papel pra imprimir os panfletos', '🔥 Comprar grampos 106/8', 'Abastecer o carro', 'Pagar o ajudante', 'Pix pro tapeceiro']) {
    assert.equal(ctx.pergunta({ titulo }, false), 'compra', titulo);
  }
});

test('card de compra com material a pagar ligado fecha pela conclusão de material: Feito não pergunta', () => {
  assert.equal(ctx.pergunta({ titulo: 'Comprar tecido do sofá' }, true), null);
});

test('card comum continua com Feito num toque só', () => {
  for (const titulo of ['Ligar pro cliente', 'Entregar poltrona', 'Calibrar pneus', 'Visita pra medir o sofá']) {
    assert.equal(ctx.pergunta({ titulo }, false), null, titulo);
  }
});

test('o Feito rápido da lista e o Feito de dentro do card usam a mesma regra', () => {
  const rapido = funcao('BotaoAdiar1h');
  assert.match(rapido, /perguntaDoFeito\(a, temMaterial\) \? abrirNaPergunta : tocar\("feito"/, 'card com pergunta não pode gravar direto pelo botão da lista');
  assert.match(rapido, /PERGUNTA_PAGOU\.pedir\(String\(a\.id\)\); FOCO\.abrir\(String\(a\.id\)\)/, 'o toque abre o card já na pergunta');
  assert.match(source, /<BotaoAdiar1h a=\{a\} acoes=\{acoes\} temMaterial=\{\(materiais \|\| \[\]\)\.length > 0\} \/>/);
  const dentro = funcao('AcoesDoCompromisso');
  assert.match(dentro, /const pergunta = perguntaDoFeito\(a, temMaterial\);/);
  assert.match(dentro, /const contaAberta = pergunta === "conta";/);
  assert.match(dentro, /const compra = pergunta === "compra";/);
});

// ---------- 2. Aviso por cima das listas ----------

test('o aviso é desenhado no body, acima das listas e do card aberto', () => {
  const z = (seletor) => { const m = css.match(new RegExp(seletor.replace(/[.]/g, '\\.') + '\\{[^}]*?z-index:(\\d+)')); assert.ok(m, 'z-index de ' + seletor); return Number(m[1]); };
  const zAviso = Math.max(...[...css.matchAll(/\.notice\{[^}]*?z-index:(\d+)/g)].map((m) => Number(m[1])));
  assert.ok(zAviso > z('.modal-overlay'), `aviso (${zAviso}) tem que ficar acima das listas (${z('.modal-overlay')})`);
  assert.match(source, /\{notice && ReactDOM\.createPortal\(<div key=\{notice\.id\} className=\{`notice \$\{notice\.kind\}`\}/);
  assert.match(source, /<span>\{notice\.text\}<\/span><\/div>, document\.body\)\}/);
});

test('o relógio de um aviso só apaga o próprio aviso', () => {
  assert.match(source, /window\.setTimeout\(\(\) => setNotice\(\(atual\) => \(atual && atual\.id === id \? null : atual\)\), 4200\);/);
  assert.doesNotMatch(source, /window\.setTimeout\(\(\) => setNotice\(null\), 4200\)/);
});

// ---------- 3. Card em foco ----------

test('o card em foco tem chave pelo card: deslizar pro lado não leva o painel do anterior', () => {
  assert.match(funcao('FocoDoCard'), /<CompromissoCard key=\{String\(a\.id\)\} \{\.\.\.props\} emFoco onSairFoco=\{onFechar\} \/>/);
});

// ---------- 4. Ordem das cargas ----------
// Modelo do que o loadAll faz na chegada de cada carga, com a regra de verdade (criarOrdemDeCargas).
function app() {
  const ordem = ctx.novaOrdem();
  const estado = { tela: 'vazia', semConexao: false, guardado: null };
  // pedir() devolve como a carga termina: chegar(dado) ou falhar()
  const pedir = ({ deFora = false } = {}) => {
    const n = ordem.pedir(deFora);
    return {
      chegar(dado) { if (!ordem.vale(n)) return false; ordem.aplicar(n); estado.tela = dado; estado.semConexao = false; estado.guardado = dado; return true; },
      falhar() { if (!ordem.vale(n)) return false; if (estado.guardado !== null) { if (!ordem.jaAplicou()) estado.tela = estado.guardado; estado.semConexao = true; } return true; },
    };
  };
  return { estado, pedir, ordem };
}

test('carga pedida ANTES do toque e que chega DEPOIS dele não volta o card pra tela', () => {
  const { estado, pedir } = app();
  pedir().chegar('12 cards');
  const doCanal = pedir({ deFora: true });      // evento do canal vivo, ainda em voo
  estado.tela = '11 cards (Feito na hora)';      // toque: o card some na hora
  const depoisDoFeito = pedir();                 // a carga que o próprio Feito pede
  assert.equal(doCanal.chegar('12 cards'), false, 'retrato de antes do Feito não entra');
  assert.equal(estado.tela, '11 cards (Feito na hora)');
  assert.equal(depoisDoFeito.chegar('11 cards'), true);
  assert.equal(estado.tela, '11 cards');
});

test('a mais velha chegando por último não troca a mais nova', () => {
  const { estado, pedir } = app();
  pedir().chegar('abertura');
  const primeira = pedir({ deFora: true }), segunda = pedir({ deFora: true });
  assert.equal(segunda.chegar('retrato novo'), true);
  assert.equal(primeira.chegar('retrato velho'), false);
  assert.equal(estado.tela, 'retrato novo');
});

test('rajada do canal vivo: cada resposta entra na ordem, a tela não espera a rajada acabar', () => {
  const { estado, pedir } = app();
  pedir().chegar('abertura');
  const a = pedir({ deFora: true }), b = pedir({ deFora: true }), c = pedir({ deFora: true });
  assert.equal(a.chegar('a'), true); assert.equal(estado.tela, 'a');
  assert.equal(b.chegar('b'), true); assert.equal(estado.tela, 'b');
  assert.equal(c.chegar('c'), true); assert.equal(estado.tela, 'c');
});

test('carga do próprio app seguida do eco do canal vivo: as duas valem, na ordem que chegarem', () => {
  const { estado, pedir } = app();
  pedir().chegar('abertura');
  const doToque = pedir(), eco = pedir({ deFora: true });
  assert.equal(doToque.chegar('depois do toque'), true);
  assert.equal(eco.chegar('eco'), true);
  assert.equal(estado.tela, 'eco');
  const doToque2 = pedir(), eco2 = pedir({ deFora: true });
  assert.equal(eco2.chegar('eco 2'), true);
  assert.equal(doToque2.chegar('depois do toque 2'), false, 'chegou depois de uma mais nova');
  assert.equal(estado.tela, 'eco 2');
});

test('a carga pedida por último nunca é descartada (é ela que desliga a barra de carregando)', () => {
  const { pedir, ordem } = app();
  for (let i = 0; i < 50; i++) {
    const cargas = [pedir({ deFora: i % 3 === 0 }), pedir({ deFora: i % 2 === 0 }), pedir({ deFora: i % 5 === 0 })];
    if (i % 4 === 0) cargas[1].chegar('meio');
    assert.equal(cargas[2].chegar('ultima ' + i), true, 'rodada ' + i);
    assert.equal(ordem.jaAplicou(), true);
  }
});

test('recarga que falha com o app já aberto: a tela fica como está e ganha a faixa de sem conexão', () => {
  const { estado, pedir } = app();
  pedir().chegar('12 cards');
  estado.tela = '11 cards (Feito na hora)';
  assert.equal(pedir().falhar(), true);
  assert.equal(estado.tela, '11 cards (Feito na hora)', 'o pacote guardado é de antes do toque: não pode voltar pra tela');
  assert.equal(estado.semConexao, true);
  pedir({ deFora: true }).chegar('11 cards');
  assert.equal(estado.semConexao, false);
});

test('abertura sem sinal: aí sim entra o pacote guardado', () => {
  const { estado, pedir } = app();
  estado.guardado = 'pacote de ontem';
  assert.equal(pedir().falhar(), true);
  assert.equal(estado.tela, 'pacote de ontem');
  assert.equal(estado.semConexao, true);
});

test('falha de uma carga velha não mexe na tela nem acende a faixa', () => {
  const { estado, pedir } = app();
  pedir().chegar('abertura');
  const velha = pedir({ deFora: true });
  pedir().chegar('depois do toque');
  assert.equal(velha.falhar(), false);
  assert.equal(estado.semConexao, false);
  assert.equal(estado.tela, 'depois do toque');
});

test('o loadAll está ligado na regra: confere antes de aplicar, e só o canal vivo pede "de fora"', () => {
  const home = source.slice(source.indexOf('function Home() {'));
  const carga = home.slice(home.indexOf('const loadAll = useCallback(async (opcoes) => {'), home.indexOf('window.__tbAtualizar = loadAll'));
  assert.ok(carga.length > 1000);
  const iPedir = carga.indexOf('const minhaCarga = ordemCargas.current.pedir(!!(opcoes && opcoes.deFora === true));');
  const iBusca = carga.indexOf('await Promise.all([');
  const iVale = carga.indexOf('if (!ordemCargas.current.vale(minhaCarga)) return;');
  const iErro = carga.indexOf('if (firstError) {');
  const iAplicar = carga.indexOf('ordemCargas.current.aplicar(minhaCarga);');
  const iPacote = carga.indexOf('aplicarPacote(pacote);');
  assert.ok(iPedir > 0 && iPedir < iBusca, 'o número é pego antes de buscar');
  assert.ok(iBusca < iVale && iVale < iErro && iErro < iAplicar && iAplicar < iPacote, 'chegou: confere se vale, trata falha, marca aplicada, põe na tela');
  assert.match(carga, /if \(guardado\) \{ if \(!ordemCargas\.current\.jaAplicou\(\)\) aplicarPacote\(guardado\.pacote\);/);
  assert.match(home, /const recarregarLogo = \(\) => \{ clearTimeout\(timer\); timer = setTimeout\(\(\) => loadAll\(\{ deFora: true \}\), 700\); \};/);
  assert.equal((home.match(/deFora: true/g) || []).length, 1, 'só o canal vivo (com a volta ao primeiro plano e a rede de volta) pede carga de fora');
});

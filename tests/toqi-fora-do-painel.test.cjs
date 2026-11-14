// TOQI E MURAL FORA DO PAINEL (Diego, 14/11/2026: "Tira do app aquele claude ler mural e o toqi lá embaixo não precisa
// mais né?"). O grupo "Toqi" do fim do Painel e a faixa "recados do Claude no Mural" ficam atrás de chaves (o código
// fica). Este teste confere as chaves, que o ↶ Desfazer dos toques continua no Painel e que a aba Mural continua.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'nova.html'), 'utf8');
const source = html.match(/<script type="text\/plain" id="app-source">([\s\S]*?)<\/script>/)[1];

test('as duas chaves estão desligadas e o caminho continua no código', () => {
  assert.match(source, /const TOQI_NO_PAINEL = false;/);
  assert.match(source, /const AVISO_MURAL = false;/);
  assert.match(source, /function ManuCard\(/, 'conserta o caminho, não remove o caminho');
  assert.match(source, /className="mural-ping"/);
});

test('o grupo Toqi só entra com a chave e o Desfazer fica no Painel sem ele', () => {
  const montagens = source.match(/<ManuCard /g) || [];
  assert.equal(montagens.length, 1, 'ManuCard montado em mais de um lugar');
  assert.match(source, /\{TOQI_NO_PAINEL \? <ManuCard [^\n]*\/> : <DesfazerRecados \/>\}/);
});

test('a faixa do Mural e o número no menu Mais dependem da chave; a aba continua', () => {
  assert.match(source, /\{AVISO_MURAL && tab !== "mural" && muralNaoLidos\.length > 0 && <button type="button" className="mural-ping"/);
  assert.match(source, /\{ id: "mural", label: "Mural", icon: "✦", count: \(AVISO_MURAL && muralNaoLidos\.length\) \|\| undefined \}/);
  assert.match(source, /\{tab === "mural" && <MuralView /, 'a aba Mural tem que continuar');
});

test('sem o grupo, a linha "Pergunta pra você" da Caixa abre a Caixa em vez de rolar pro nada', () => {
  assert.match(source, /onClick=\{t === "pergunta" && TOQI_NO_PAINEL \? \(\) => \{ vibrar\(6\); document\.getElementById\("grupo-manu"\)/);
  const soltos = source.match(/t === "pergunta" \? \(\) => \{ vibrar\(6\); document\.getElementById\("grupo-manu"\)/g);
  assert.equal(soltos, null);
});

test('sem o grupo, nenhum texto manda o Diego pro card da Manu ou pro grupo Toqi', () => {
  assert.match(source, /\{t === "pergunta" && TOQI_NO_PAINEL \? <span className="linha-sub">responda no card da Manu<\/span> : null\}/);
  assert.match(source, /<i>\{t === "pergunta" && TOQI_NO_PAINEL \? "Manu ↓" : "abrir ›"\}<\/i>/);
  assert.match(source, /\{TOQI_NO_PAINEL \? "Dá pra desfazer no grupo Toqi, no fim do Painel\." : "Dá pra desfazer em “Toques nos cards”, no fim do Painel\."\}/);
  const soltos = source.match(/[^"]Dá pra desfazer no grupo Toqi/g);
  assert.equal(soltos, null, 'texto do grupo Toqi sem a chave');
});

test('a pergunta da Caixa abre a Caixa na própria pergunta', () => {
  assert.match(source, /t === "pergunta" \? \(\) => onAbrirCaixa\(filaCaixa\.find\(\(it\) => tipoDoItemDaCaixa\(it\) === "pergunta"\)\?\.id\) : onAbrirCaixa\}/);
  assert.match(source, /onAbrirCaixa=\{\(id\) => \{ setCaixaAbrirId\(typeof id === "string" \|\| typeof id === "number" \? id : null\); setTab\("caixa"\); window\.scrollTo\(0, 0\); \}\}/);
});

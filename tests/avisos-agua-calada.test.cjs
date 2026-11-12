// A ÁGUA APITA UMA VEZ, DEPOIS SÓ TROCA AS HORAS (11/11/2026). De 04 a 11/11 saíram 138 avisos de água, um por hora, e
// "Bebi" foi marcado 5 vezes. O aviso continua saindo de hora em hora, mas só apita o primeiro de cada série (3h depois
// do copo, e todo dia na abertura das 08:00). A repetição só troca o texto na barra, calada, quando o aviso que apitou
// ainda está lá; se ele tirou da barra sem beber, ou o primeiro se perdeu ou chegou atrasado, a repetição apita.
// Roda a função push-enviar (TypeScript, compilada com o mesmo Babel do app) e o sw.js de verdade num navegador de
// mentira. Nada aqui fala com o banco nem manda aviso.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const fonteFn = fs.readFileSync(path.join(raiz, 'edge-functions/push-enviar/index.ts'), 'utf8');
const fonteSw = fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8');

// ---------------------------------------------------------------- a função (servidor)
function ligarFuncao() {
  assert.ok(process.env.BAHIA_BABEL_PATH, 'Defina BAHIA_BABEL_PATH=<caminho>/@babel/standalone/babel.min.js');
  const Babel = require(process.env.BAHIA_BABEL_PATH);
  const js = Babel.transform(fonteFn, { presets: ['typescript'], filename: 'index.ts', sourceType: 'script' }).code;
  const mundo = {
    console, URL, Response, Request, TextEncoder, TextDecoder, crypto: globalThis.crypto, atob, btoa,
    setTimeout, clearTimeout,
    Deno: { env: { get: () => 'https://exemplo.test' }, serve: () => {} },
    fetch: async () => { throw new Error('a função não pode falar com a rede no teste'); },
  };
  vm.createContext(mundo);
  vm.runInContext(js, mundo, { filename: 'push-enviar.js' });
  return vm.runInContext('({ passoAgua, vezAgua, chaveAgua, avisoDaAgua, aguaNaJanela, AGUA_AVISA_MIN })', mundo);
}
const fn = ligarFuncao();

// Um dia de varreduras (de 5 em 5 min) com o último copo às 20:00 da véspera. Devolve um aviso por chave nova.
function diaDeAgua({ ultimoCopo, de, ate }) {
  const sp = (ms) => new Date(ms - 3 * 3600e3).toISOString().slice(0, 19); // hora de Brasília escrita como o banco manda
  const avisos = [], vistas = new Set();
  for (let agora = de; agora <= ate; agora += 5 * 60e3) {
    const hora = Number(sp(agora).slice(11, 13));
    const minutos = Math.floor((agora - ultimoCopo) / 60e3);
    if (!fn.aguaNaJanela(hora) || minutos < fn.AGUA_AVISA_MIN) continue;
    const ag = { ultima_id: ultimoCopo / 1000, minutos, ultima: '20:00' };
    const passo = fn.passoAgua(ag, sp(agora), agora);
    const chave = `agua:${ag.ultima_id}:${passo.vez}`;
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    const [envio] = fn.avisoDaAgua({ ...ag, chave, repeticao: passo.repeticao });
    avisos.push({ quando: sp(agora).slice(11, 16), calado: envio.aviso.atualiza_calado === true, aviso: envio.aviso });
  }
  return avisos;
}
const BRT = (dia, hora, min = 0) => Date.UTC(2026, 10, dia, hora + 3, min);

test('água sem nenhum "Bebi": sai de hora em hora como antes, mas só o das 08:00 vem pra tocar', () => {
  const avisos = diaDeAgua({ ultimoCopo: BRT(10, 20), de: BRT(11, 3), ate: BRT(12, 2, 55) });
  assert.equal(avisos.length, 19, 'a cadência não mudou: 08h às 23h e 00h às 02h');
  assert.deepEqual(avisos.map((a) => a.quando), ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00', '00:00', '01:00', '02:00']);
  assert.deepEqual(avisos.filter((a) => !a.calado).map((a) => a.quando), ['08:00'], 'só o primeiro da série vem sem o sinal');
  // No dia seguinte a série recomeça às 08:00 e toca de novo, mesmo sem copo nenhum no meio.
  const diaSeguinte = diaDeAgua({ ultimoCopo: BRT(10, 20), de: BRT(12, 3), ate: BRT(12, 10) });
  assert.deepEqual(diaSeguinte.map((a) => [a.quando, a.calado]), [['08:00', false], ['09:00', true], ['10:00', true]]);
});

test('água depois de um copo: o primeiro aviso, 3h depois, vem pra tocar; os seguintes só atualizam', () => {
  const avisos = diaDeAgua({ ultimoCopo: BRT(11, 10, 10), de: BRT(11, 10, 10), ate: BRT(11, 16, 30) });
  assert.deepEqual(avisos.map((a) => [a.quando, a.calado]), [['13:10', false], ['14:10', true], ['15:10', true], ['16:10', true]]);
});

test('água: o resto do aviso não mudou (texto, botão Bebi, tag, validade de 1 hora)', () => {
  const [envio] = fn.avisoDaAgua({ ultima_id: 1700000000, minutos: 245, ultima: '09:15', chave: 'agua:1700000000:1', repeticao: 1 });
  assert.equal(envio.aviso.titulo, '💧 4h05 sem beber água');
  assert.equal(envio.aviso.tag, 'agua');
  assert.equal(envio.aviso.ttl, 3600);
  assert.deepEqual(Array.from(envio.aviso.acoes, (b) => b.title), ['Bebi']);
  assert.equal(envio.aviso.atualiza_calado, true);
  const [primeiro] = fn.avisoDaAgua({ ultima_id: 1700000000, minutos: 180, ultima: '09:15', chave: 'agua:1700000000:0', repeticao: 0 });
  assert.ok(!('atualiza_calado' in primeiro.aviso), 'o primeiro da série não leva o sinal');
});

// ---------------------------------------------------------------- o service worker (celular)
function ligarSw({ getNotificationsFalha = false, recusaOpcoes = false } = {}) {
  const ouvintes = {}, barra = [], mostrados = [], leituras = [];
  const registration = {
    async getNotifications(filtro) {
      leituras.push(filtro || null);
      if (getNotificationsFalha && filtro && filtro.tag) throw new Error('barra indisponível');
      return barra.filter((n) => !filtro || !filtro.tag || n.tag === filtro.tag);
    },
    async showNotification(titulo, opcoes) {
      if (recusaOpcoes && 'renotify' in opcoes) throw new TypeError('opção recusada');
      const n = { title: titulo, ...opcoes, data: { ...(opcoes.data || {}) }, timestamp: Date.now(), close() { const i = barra.indexOf(n); if (i >= 0) barra.splice(i, 1); } };
      const i = barra.findIndex((x) => x.tag === n.tag);
      if (i >= 0) barra.splice(i, 1, n); else barra.push(n);
      mostrados.push(n);
    },
  };
  const mundo = {
    console, URL, Response, Request, AbortController,
    setTimeout, clearTimeout,
    location: new URL('https://exemplo.test/painel/sw.js'),
    caches: { open: async () => ({ match: async () => undefined, put: async () => {}, add: async () => {}, addAll: async () => {}, keys: async () => [], delete: async () => false }), match: async () => undefined, keys: async () => [], delete: async () => false },
    fetch: async () => new Response('{"velhos":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    addEventListener: (tipo, f) => { ouvintes[tipo] = f; },
    skipWaiting: async () => {},
    clients: { claim: async () => {}, matchAll: async () => [] },
    registration,
  };
  mundo.self = mundo;
  vm.createContext(mundo);
  vm.runInContext(fonteSw, mundo, { filename: 'sw.js' });
  const chegar = async (aviso) => {
    const esperas = [];
    ouvintes.push({ data: { json: () => aviso, text: () => JSON.stringify(aviso) }, waitUntil: (p) => esperas.push(p) });
    await Promise.all(esperas);
    return mostrados[mostrados.length - 1];
  };
  return { chegar, barra, mostrados, leituras };
}
const agoraISO = (minutosAtras = 0) => new Date(Date.now() - minutosAtras * 60e3).toISOString();
const agua = (extra = {}) => ({ titulo: '💧 3h00 sem beber água', corpo: 'Último copo às 09:15. Bebe um copo agora.', tag: 'agua', url: './nova.html', recibo: 'r-agua', gerado_em: agoraISO(), acoes: [{ action: 'a0', title: 'Bebi' }], item: { tipo: 'agua', ultima_id: 1 }, ...extra });
const tocou = (n) => n.silent === false && n.renotify === true && Array.isArray(n.vibrate);
const calado = (n) => n.silent === true && n.renotify === false && !('vibrate' in n);

test('celular: o primeiro aviso de água toca; a repetição troca o texto calada enquanto ele está na barra', async () => {
  const sw = ligarSw();
  const primeiro = await sw.chegar(agua());
  assert.ok(tocou(primeiro), 'o primeiro toca e vibra');
  assert.equal(primeiro.data.tocou, true);
  const segundo = await sw.chegar(agua({ titulo: '💧 4h00 sem beber água', atualiza_calado: true, recibo: 'r-agua-2' }));
  assert.ok(calado(segundo), 'a repetição não toca nem vibra');
  assert.equal(segundo.title, '💧 4h00 sem beber água', 'mas o texto na barra é o novo');
  assert.equal(segundo.data.tocou, true, 'a marca segue: a hora seguinte também vem calada');
  assert.deepEqual(Array.from(segundo.actions, (b) => b.title), ['Bebi'], 'o botão Bebi continua');
  assert.equal(segundo.requireInteraction, true, 'e o aviso continua preso na barra');
  assert.equal(sw.barra.filter((n) => n.tag === 'agua').length, 1, 'um aviso de água só na barra');
  const terceiro = await sw.chegar(agua({ titulo: '💧 5h00 sem beber água', atualiza_calado: true, recibo: 'r-agua-3' }));
  assert.ok(calado(terceiro));
});

test('celular: tirou o aviso da barra sem beber, a repetição seguinte toca de novo', async () => {
  const sw = ligarSw();
  await sw.chegar(agua());
  sw.barra.length = 0; // ele deslizou pra fora
  const depois = await sw.chegar(agua({ atualiza_calado: true, recibo: 'r-agua-2' }));
  assert.ok(tocou(depois));
  assert.equal(depois.data.tocou, true);
});

test('celular: o primeiro de cada série toca mesmo com o aviso de ontem ainda na barra', async () => {
  const sw = ligarSw();
  await sw.chegar(agua());
  await sw.chegar(agua({ atualiza_calado: true, recibo: 'r-agua-2' }));
  const das8 = await sw.chegar(agua({ titulo: '💧 12h00 sem beber água', recibo: 'r-agua-3' })); // sem o sinal
  assert.ok(tocou(das8));
});

test('celular: se o primeiro chegou atrasado (calado), a repetição seguinte toca', async () => {
  const sw = ligarSw();
  const atrasado = await sw.chegar(agua({ gerado_em: agoraISO(11) }));
  assert.ok(calado(atrasado), 'aviso gerado há mais de 10 min aparece calado (regra da v28)');
  assert.equal(atrasado.data.tocou, false, 'e fica marcado como não tocado');
  const repeticao = await sw.chegar(agua({ atualiza_calado: true, recibo: 'r-agua-2' }));
  assert.ok(tocou(repeticao), 'senão a série inteira passaria sem tocar nenhuma vez');
  // Repetição atrasada por cima de um que tocou: calada, e a marca fica.
  const outraAtrasada = await sw.chegar(agua({ atualiza_calado: true, gerado_em: agoraISO(30), recibo: 'r-agua-3' }));
  assert.ok(calado(outraAtrasada));
  assert.equal(outraAtrasada.data.tocou, true);
});

test('celular: se a barra não puder ser lida, a repetição toca (erra pro lado do barulho)', async () => {
  const sw = ligarSw({ getNotificationsFalha: true });
  await sw.chegar(agua());
  const repeticao = await sw.chegar(agua({ atualiza_calado: true, recibo: 'r-agua-2' }));
  assert.ok(tocou(repeticao));
});

test('celular: aviso de card continua igual (toca toda vez, vibra forte) e não lê a barra antes de mostrar', async () => {
  const sw = ligarSw();
  const card = { titulo: 'Agora 10:00 · Visita', corpo: 'Visita pra medir', tag: 'agenda-c1', url: './nova.html?ir=agenda&card=c1', recibo: 'r-c1', gerado_em: agoraISO(), acoes: [{ action: 'a0', title: 'Feito' }, { action: 'a1', title: 'Adiar 1h' }], item: { tipo: 'agenda', id: 'c1' } };
  const um = await sw.chegar(card);
  const dois = await sw.chegar({ ...card, recibo: 'r-c1-2' });
  for (const n of [um, dois]) {
    assert.ok(tocou(n));
    assert.deepEqual(Array.from(n.vibrate), [400, 150, 400, 150, 700]);
    assert.equal(n.requireInteraction, true);
  }
  assert.equal(sw.leituras.filter((f) => f && f.tag).length, 0, 'só o aviso que atualiza calado consulta a barra pela tag');
  // Um aviso de card com o sinal por engano não existe hoje; se um dia existir, a regra é a mesma da água.
  const atrasado = await sw.chegar({ ...card, recibo: 'r-c1-3', gerado_em: agoraISO(15) });
  assert.ok(calado(atrasado), 'card atrasado continua chegando calado');
});

test('celular: se o Chrome recusar as opções, o aviso básico aparece do mesmo jeito', async () => {
  const sw = ligarSw({ recusaOpcoes: true });
  const n = await sw.chegar(agua({ atualiza_calado: true }));
  assert.equal(n.title, '💧 3h00 sem beber água');
  assert.equal(n.tag, 'agua');
  assert.equal(sw.barra.length, 1);
});

test('versão do service worker subiu junto, e as duas páginas registram o mesmo endereço', () => {
  const versao = Number((fonteSw.match(/const VERSAO = 'tb-atendimento-v(\d+)'/) || [])[1]);
  assert.ok(versao >= 30, 'o sw.js mudou: a VERSAO sobe (regra do CLAUDE.md)');
  const nova = fs.readFileSync(path.join(raiz, 'nova.html'), 'utf8');
  const estoque = fs.readFileSync(path.join(raiz, 'estoque.html'), 'utf8');
  const vNova = (nova.match(/register\('\.\/sw\.js\?v=(\d+)'\)/) || [])[1];
  const vEstoque = (estoque.match(/register\('\.\/sw\.js\?v=(\d+)'\)/) || [])[1];
  assert.ok(Number(vNova) >= 24);
  assert.equal(vEstoque, vNova, 'endereço diferente troca o service worker e o app recarrega duas vezes');
});

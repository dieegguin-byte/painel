// UM ENVIO QUE FALHA NÃO DERRUBA A VARREDURA (11/11/2026, lista de melhorias do app). Roda a função push-enviar inteira
// (compilada com o mesmo Babel do app) com banco e Google de mentira. Antes: se a rede caía num envio, ou se a anotação
// do aparelho falhava depois de o Google aceitar, a varredura terminava em 500, os outros avisos não saíam e as chaves
// ficavam reservadas pra sempre. Nada aqui fala com o banco de verdade nem manda aviso.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const fonteFn = fs.readFileSync(path.join(__dirname, '..', 'edge-functions/push-enviar/index.ts'), 'utf8');
assert.ok(process.env.BAHIA_BABEL_PATH, 'Defina BAHIA_BABEL_PATH=<caminho>/@babel/standalone/babel.min.js');
const Babel = require(process.env.BAHIA_BABEL_PATH);
const js = Babel.transform(fonteFn, { presets: ['typescript'], filename: 'index.ts', sourceType: 'script' }).code;
const sub = globalThis.crypto.subtle;
const b64 = (buf) => Buffer.from(buf).toString('base64url');

// Pendências de uma varredura às 10:00: um card entrando na janela de 60 min, um card na hora, uma rotina e uma conta.
const PENDENCIAS = {
  agora: '2026-11-11T10:00:02.5', hoje: '2026-11-11',
  agenda: [{ id: 'c2', titulo: 'Buscar sofá Fulana', data: '2026-11-11', hora: '10:55', faltam: 55, na_janela: true }],
  agenda_na_hora: [{ id: 'c1', titulo: 'Visita Fulano', data: '2026-11-11', hora: '10:00', passaram: 0, visto: false }],
  agenda_hoje: [], rotinas_na_hora: [{ id: 'r1', titulo: 'Comprar pão', hora: '10:00', adiada_ate: null }],
  agua: null, caixa: [], duvidas: [],
  contas: [{ id: 'f1', descricao: 'Conta de teste', categoria: 'Conta', escopo: 'empresa', valor: 10, data: '2026-11-13', dias: 2 }],
  resumo: {},
};

async function varredura({ falharEnvioN = null, falharAnotacao = false, bancoSoluca = false } = {}) {
  const par = await sub.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await sub.exportKey('jwk', par.privateKey);
  const publica = b64(await sub.exportKey('raw', par.publicKey));
  const aparelho = await sub.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const p256dh = b64(await sub.exportKey('raw', aparelho.publicKey));
  const auth = b64(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  const reservadas = [], soltas = [], entregues = [];
  let nEnvio = 0, handler = null, reciboFalhou = false, soltarFalhou = false;
  const resp = (corpo, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)) });
  const fetchFalso = async (url, init = {}) => {
    url = String(url);
    if (url.startsWith('https://push.exemplo/')) {
      nEnvio++;
      if (falharEnvioN === nEnvio) throw new TypeError('a rede caiu no envio');
      entregues.push(nEnvio);
      return resp(undefined, 201);
    }
    const corpo = init.body ? JSON.parse(init.body) : {};
    if (url.includes('/rpc/push_segredo')) return resp({ VAPID_PRIVATE_JWK: JSON.stringify(jwk), VAPID_PUBLIC: publica, PUSH_SECRET: 'segredo' }[corpo.nome] ?? null);
    if (url.includes('/rpc/push_pendencias')) return resp(PENDENCIAS);
    if (url.includes('/rpc/push_reservar')) { reservadas.push(...corpo.chaves); return resp(corpo.chaves); }
    if (url.includes('/rpc/push_soltar')) {
      if (bancoSoluca && !soltarFalhou) { soltarFalhou = true; return resp({ message: 'banco fora' }, 503); }
      soltas.push(...corpo.chaves); return resp(null);
    }
    if (url.includes('/rpc/push_recibo_abrir')) {
      if (bancoSoluca && !reciboFalhou) { reciboFalhou = true; return resp({ message: 'banco fora' }, 503); }
      return resp(globalThis.crypto.randomUUID());
    }
    if (url.includes('/push_assinaturas?ativo=eq.true')) return resp([{ id: 'a1', endpoint: 'https://push.exemplo/envio/abc', p256dh, auth }]);
    if (url.includes('/push_assinaturas?id=eq.')) return falharAnotacao ? resp({ message: 'tempo esgotado' }, 500) : resp(undefined, 204);
    throw new Error('pedido sem resposta no teste: ' + url);
  };
  const mundo = {
    console: { log() {}, error() {}, warn() {} }, URL, Response, Request, TextEncoder, TextDecoder, crypto: globalThis.crypto, atob, btoa,
    setTimeout, clearTimeout, fetch: fetchFalso,
    Deno: { env: { get: (k) => (k === 'SUPABASE_URL' ? 'https://banco.exemplo' : 'chave') }, serve: (h) => { handler = h; } },
  };
  vm.createContext(mundo);
  vm.runInContext(js, mundo, { filename: 'push-enviar.js' });
  const r = await handler(new Request('https://funcao.exemplo/push-enviar', {
    method: 'POST', headers: { 'x-push-secret': 'segredo', 'Content-Type': 'application/json' }, body: JSON.stringify({ modo: 'varredura' }),
  }));
  return { status: r.status, corpo: await r.json(), reservadas, soltas, entregues };
}

test('tudo certo: os 4 avisos saem e nenhuma chave é solta', async () => {
  const v = await varredura();
  assert.equal(v.status, 200);
  assert.equal(v.corpo.envios, 4);
  assert.equal(v.entregues.length, 4);
  assert.deepEqual(v.soltas, []);
});

test('a rede cai no 1º envio: só a chave dele é solta, os outros 3 saem, sem 500', async () => {
  const v = await varredura({ falharEnvioN: 1 });
  assert.equal(v.status, 200, JSON.stringify(v.corpo));
  assert.equal(v.entregues.length, 3);
  assert.equal(v.soltas.length, 1, 'só a chave do aviso que não saiu volta pra fila');
  assert.ok(v.reservadas.includes(v.soltas[0]));
  const falho = v.corpo.relatorio.find((x) => x.entregues === 0);
  assert.match(falho.erros[0], /a rede caiu/);
});

test('a anotação do aparelho falha depois do envio: os 4 avisos contam como entregues, sem 500', async () => {
  const v = await varredura({ falharAnotacao: true });
  assert.equal(v.status, 200, JSON.stringify(v.corpo));
  assert.equal(v.entregues.length, 4);
  assert.deepEqual(v.soltas, [], 'aviso que o Google aceitou não volta pra fila (senão sairia duas vezes)');
  assert.ok(v.corpo.relatorio.every((x) => x.entregues === 1));
});

test('o banco soluça no 1º aviso (recibo e soltar dão 503): a chave dele fica presa, os outros 3 saem, sem 500', async () => {
  const v = await varredura({ bancoSoluca: true });
  assert.equal(v.status, 200, JSON.stringify(v.corpo));
  assert.equal(v.entregues.length, 3);
  assert.deepEqual(v.soltas, [], 'o soltar falhou: nada voltou pra fila, mas a varredura não caiu');
  const falho = v.corpo.relatorio.find((x) => x.entregues === 0);
  assert.match(falho.erros[0], /push_recibo_abrir 503/);
});

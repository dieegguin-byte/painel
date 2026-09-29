// PUSH-ENVIAR — a notificação do app no celular do Diego. 29/08/2026.
//
// Antes disso o app não tinha UMA LINHA de push: nem Notification, nem pushManager, nem VAPID.
// "Notificação não chega" nunca foi bug, era funcionalidade que não existia.
//
// POR QUE SEM BIBLIOTECA. As libs de web push são feitas pra Node e trazem dependência de build.
// Aqui é Deno puro com WebCrypto, que já tem tudo o que o protocolo pede: ECDH P-256, HMAC-SHA256,
// AES-128-GCM e ECDSA. São ~60 linhas de criptografia e nenhum import.
//
// PROTOCOLO (o que cada pedaço implementa):
//   RFC 8292 — VAPID: um JWT ES256 no header Authorization prova pro FCM/Mozilla quem está mandando.
//   RFC 8291 — deriva a chave da mensagem a partir do par efêmero + p256dh + auth do aparelho.
//   RFC 8188 — empacota como aes128gcm: salt | rs | idlen | chave_efêmera | cifra.
// O servidor de push (Google, no caso do Android) NÃO consegue ler o conteúdo: só o celular tem a
// chave privada. Por isso o payload vai junto, e o service worker não precisa buscar nada na rede.

const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CONTATO = "mailto:dieegguin@gmail.com"; // exigido pelo VAPID: quem procurar em caso de abuso

// ---------------------------------------------------------------- utilidades

const utf8 = (s: string) => new TextEncoder().encode(s);

function juntar(...partes: Uint8Array[]): Uint8Array {
  const total = partes.reduce((s, p) => s + p.length, 0);
  const saida = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) { saida.set(p, pos); pos += p.length; }
  return saida;
}

function deB64url(txt: string): Uint8Array {
  const b = txt.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
  const saida = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) saida[i] = bin.charCodeAt(i);
  return saida;
}

function paraB64url(dados: Uint8Array | ArrayBuffer): string {
  const u = dados instanceof Uint8Array ? dados : new Uint8Array(dados);
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(chave: Uint8Array, dados: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", chave, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, dados));
}

async function rpc(nome: string, args: Record<string, unknown> = {}): Promise<any> {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${nome}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`rpc ${nome} ${r.status}: ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : null;
}

async function rest(caminho: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${URL_BASE}/rest/v1/${caminho}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`rest ${caminho} ${r.status}: ${txt.slice(0, 200)}`);
  return txt ? JSON.parse(txt) : null;
}

// ---------------------------------------------------------------- chave VAPID
// Nasce DENTRO daqui e vai direto pro vault. Nunca passa por arquivo, por chat, nem pelo repositório.
// Só é gerada uma vez: trocar a chave invalidaria todas as assinaturas já feitas nos aparelhos, e o
// Diego teria que autorizar de novo — sem entender por quê.

let vapidCache: { jwk: JsonWebKey; publica: string } | null = null;

async function vapid(): Promise<{ jwk: JsonWebKey; publica: string }> {
  if (vapidCache) return vapidCache;
  let priv = await rpc("push_segredo", { nome: "VAPID_PRIVATE_JWK" });
  let pub = await rpc("push_segredo", { nome: "VAPID_PUBLIC" });
  if (!priv || !pub) {
    const par = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", par.privateKey);
    const bruta = await crypto.subtle.exportKey("raw", par.publicKey); // 65 bytes: 0x04 | X | Y
    await rpc("push_segredo_criar", { nome: "VAPID_PRIVATE_JWK", valor: JSON.stringify(jwk), nota: "Chave privada VAPID do push do app. Gerada pela Edge Function push-enviar. Trocar invalida todas as assinaturas." });
    await rpc("push_segredo_criar", { nome: "VAPID_PUBLIC", valor: paraB64url(bruta), nota: "Chave publica VAPID. Vai hardcoded no nova.html - e publica por definicao." });
    // Relê: se duas execuções correram juntas, `criar` recusou a segunda e vale a que gravou primeiro.
    priv = await rpc("push_segredo", { nome: "VAPID_PRIVATE_JWK" });
    pub = await rpc("push_segredo", { nome: "VAPID_PUBLIC" });
  }
  vapidCache = { jwk: JSON.parse(priv), publica: pub };
  return vapidCache;
}

async function jwtVapid(audiencia: string, jwk: JsonWebKey): Promise<string> {
  const chave = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const cabecalho = paraB64url(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const corpo = paraB64url(utf8(JSON.stringify({
    aud: audiencia,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600, // o limite do protocolo é 24h
    sub: CONTATO,
  })));
  // WebCrypto assina ECDSA já no formato cru r|s (64 bytes), que é exatamente o que o JWS pede.
  const assinatura = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, chave, utf8(`${cabecalho}.${corpo}`));
  return `${cabecalho}.${corpo}.${paraB64url(assinatura)}`;
}

// ------------------------------------------------------- criptografia RFC 8291

async function cifrar(texto: string, p256dh: string, auth: string): Promise<Uint8Array> {
  const chavePublicaAparelho = deB64url(p256dh);  // 65 bytes
  const segredoAuth = deB64url(auth);             // 16 bytes

  // Par efêmero: um novo por mensagem. É o que dá sigilo mesmo se a chave do aparelho vazar depois.
  const efemero = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicaEfemera = new Uint8Array(await crypto.subtle.exportKey("raw", efemero.publicKey));

  const aparelho = await crypto.subtle.importKey("raw", chavePublicaAparelho, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const compartilhado = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: aparelho }, efemero.privateKey, 256));

  // HKDF do RFC 8291: primeiro mistura o segredo `auth` com o segredo ECDH.
  const prkAuth = await hmac(segredoAuth, compartilhado);
  const infoChave = juntar(utf8("WebPush: info"), new Uint8Array([0]), chavePublicaAparelho, publicaEfemera);
  const ikm = await hmac(prkAuth, juntar(infoChave, new Uint8Array([1])));

  // Agora o HKDF do RFC 8188, que produz a chave e o nonce do AES-GCM.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, juntar(utf8("Content-Encoding: aes128gcm"), new Uint8Array([0, 1])))).slice(0, 16);
  const nonce = (await hmac(prk, juntar(utf8("Content-Encoding: nonce"), new Uint8Array([0, 1])))).slice(0, 12);

  const aes = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  // 0x02 marca "último registro". Sem esse byte o navegador descarta a mensagem calado.
  const claro = juntar(utf8(texto), new Uint8Array([2]));
  const cifra = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aes, claro));

  const tamanhoRegistro = new Uint8Array(4);
  new DataView(tamanhoRegistro.buffer).setUint32(0, 4096);
  return juntar(salt, tamanhoRegistro, new Uint8Array([publicaEfemera.length]), publicaEfemera, cifra);
}

// ---------------------------------------------------------------- envio

type Assinatura = { id: string; endpoint: string; p256dh: string; auth: string };

async function entregar(assinatura: Assinatura, aviso: unknown): Promise<{ ok: boolean; status: number; erro: string; recibo?: string }> {
  const vp = await vapid();
  const audiencia = new URL(assinatura.endpoint).origin;
  // TELEMETRIA DE ENTREGA. Sem isto eu só enxergo até o Google: ele devolve 201 em 1 segundo e a
  // notificação some de vista. O recibo viaja DENTRO da carga cifrada; o service worker devolve no
  // instante em que o evento `push` chega nele. Comparar as duas horas separa as duas causas
  // possíveis — aparelho que não recebe (Android segurando) e aparelho que recebe e não mostra.
  const recibo = await rpc("push_recibo_abrir", { p_tag: (aviso as any)?.tag ?? null });
  const corpo = await cifrar(JSON.stringify({ ...(aviso as any), recibo }), assinatura.p256dh, assinatura.auth);
  const r = await fetch(assinatura.endpoint, {
    method: "POST",
    headers: {
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "high",
      Authorization: `vapid t=${await jwtVapid(audiencia, vp.jwk)}, k=${vp.publica}`,
    },
    body: corpo,
  });
  const erro = r.ok ? "" : (await r.text()).slice(0, 300);
  // 404/410 = o Android desinstalou/reinstalou o app e esse endpoint morreu. Some da lista sozinho,
  // senão toda varredura futura gasta uma requisição em algo que nunca mais vai entregar.
  if (r.status === 404 || r.status === 410) {
    await rest(`push_assinaturas?id=eq.${assinatura.id}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ ativo: false, ultimo_erro: `${r.status} endpoint morto` }),
    });
  } else {
    await rest(`push_assinaturas?id=eq.${assinatura.id}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify(r.ok
        ? { ultimo_ok: new Date().toISOString(), ultimo_erro: null, falhas: 0 }
        : { ultimo_erro: `${r.status} ${erro}` }),
    });
  }
  return { ok: r.ok, status: r.status, erro, recibo };
}

async function assinaturasAtivas(): Promise<Assinatura[]> {
  return await rest("push_assinaturas?ativo=eq.true&select=id,endpoint,p256dh,auth");
}

// Um envio pode cobrir VÁRIOS itens: quando quatro compromissos caem na mesma hora, vai uma notificação
// só, e as quatro chaves ficam marcadas como entregues.
type Envio = { chaves: string[]; aviso: unknown; d3?: string[] };

// Manda o mesmo aviso pra todos os aparelhos. Se NENHUM aceitou, solta as reservas pra que a próxima
// varredura tente de novo — perder um lembrete por causa de um 500 do FCM seria pior.
async function difundir(envios: Envio[]): Promise<any[]> {
  if (!envios.length) return [];
  const alvos = await assinaturasAtivas();
  const relatorio: any[] = [];
  for (const item of envios) {
    if (!alvos.length) {
      await rpc("push_soltar", { chaves: item.chaves });
      relatorio.push({ chaves: item.chaves, status: "sem aparelho inscrito" });
      continue;
    }
    const saidas = [];
    for (const alvo of alvos) saidas.push(await entregar(alvo, item.aviso));
    if (!saidas.some((s) => s.ok)) await rpc("push_soltar", { chaves: item.chaves });
    relatorio.push({
      chaves: item.chaves,
      entregues: saidas.filter((s) => s.ok).length,
      de: saidas.length,
      erros: saidas.filter((s) => !s.ok).map((s) => `${s.status} ${s.erro}`),
    });
  }
  return relatorio;
}

// ---------------------------------------------------------------- os gatilhos

const dinheiro = (v: number) => "R$ " + Number(v).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");

// A LEVA. O `push_pendencias` devolve as próximas 6 horas; aqui se decide onde cortar.
//
// POR QUE ISTO EXISTE (01/09/2026): na manhã de 31/08 o Diego recebeu CINCO lembretes separados, que é
// justamente o que o agrupamento devia impedir. O agrupamento funcionava, mas nunca tinha dois itens
// pra juntar: a varredura roda a cada 5 min e só enxergava a janela de 60 min, então cada compromisso
// entrava sozinho na sua vez. O defeito não estava em juntar, estava em olhar perto demais.
//
// A regra é a de uma leva de verdade: dispara pelo primeiro que entrou na janela e encadeia os
// seguintes enquanto o intervalo entre eles for de no máximo 60 min. Uma sequência (08:00, 08:15,
// 08:45, 09:00) vira um aviso só; um compromisso isolado às 10:30 NÃO é arrastado junto — ele ganha o
// próprio lembrete na hora dele, que é o ponto de ter lembrete.
function levaDaAgenda(agenda: any[]): any[] {
  if (!agenda.length || !agenda[0].na_janela) return [];
  const leva = [agenda[0]];
  for (let i = 1; i < agenda.length; i++) {
    if (agenda[i].faltam - leva[leva.length - 1].faltam > 60) break;
    leva.push(agenda[i]);
  }
  return leva;
}

// Recebe SÓ o que ainda não foi notificado (a reserva acontece antes, no roteador). Por isso pode
// agrupar sem medo: o texto do lote é montado apenas com item novo.
function avisosDaVarredura(agenda: any[], caixa: any[]): Envio[] {
  const lista: Envio[] = [];

  // COMPROMISSO DA AGENDA. Um só vira notificação individual, com lugar e quanto falta — é acionável.
  if (agenda.length === 1) {
    const a = agenda[0];
    const onde = [a.local, a.cidade].filter(Boolean).join(" · ");
    lista.push({
      chaves: [`agenda:${a.id}`],
      aviso: {
        titulo: `${a.hora} · ${String(a.titulo || "").slice(0, 80)}`,
        corpo: [onde, a.faltam >= 0 ? `em ${a.faltam} min` : null].filter(Boolean).join(" — ") || "Compromisso agendado",
        tag: `agenda-${a.id}`,
        url: "./nova.html?ir=agenda",
      },
    });
  } else if (agenda.length > 1) {
    // A LEVA INTEIRA NUM AVISO SÓ. Os envelopes de TRIAGEM que o Classic cria caem de 15 em 15 min —
    // na manhã de 31/08 isso virou CINCO notificações seguidas, que é o caminho mais curto pra ele
    // desligar a permissão. O título diz a hora do primeiro, e não "na próxima hora": a leva pode
    // passar de uma hora quando os compromissos vêm encadeados. Agrupar não descarta nada: todos os
    // títulos vão no corpo, e nenhum deles é notificado de novo depois.
    lista.push({
      chaves: agenda.map((a) => `agenda:${a.id}`),
      aviso: {
        titulo: `${agenda.length} compromissos a partir das ${agenda[0].hora}`,
        corpo: agenda.map((a) => `${a.hora} ${String(a.titulo || "").slice(0, 40)}`).join(" · ").slice(0, 170),
        tag: "agenda-lote",
        url: "./nova.html?ir=agenda",
      },
    });
  }

  // CAIXA DE ENTRADA — individual, mas só o que chegou nas últimas 24h. O backlog foi semeado como
  // já-enviado na virada, senão a primeira execução mandaria 41 notificações de uma vez.
  if (caixa.length === 1) {
    const c = caixa[0];
    lista.push({
      chaves: [`caixa:${c.id}`],
      aviso: {
        titulo: "Nova entrada na caixa",
        corpo: String(c.texto || "").replace(/\s+/g, " ").slice(0, 140),
        tag: `caixa-${c.id}`,
        url: "./nova.html?ir=caixa",
      },
    });
  } else if (caixa.length > 1) {
    lista.push({
      chaves: caixa.map((c) => `caixa:${c.id}`),
      aviso: {
        titulo: `${caixa.length} entradas novas na caixa`,
        corpo: caixa.map((c) => String(c.texto || "").replace(/\s+/g, " ").slice(0, 50)).join(" · ").slice(0, 170),
        tag: "caixa-lote",
        url: "./nova.html?ir=caixa",
      },
    });
  }
  return lista;
}

// ---------------------------------------------------------------- contas a pagar (D-3)
//
// RECADO DO CLASSIC DE 26/09/2026. O resumo das 07:30 dizia "14 conta(s) a pagar · R$ 3.665,27" e mais
// nada — e 8 dessas 14 eram mão de obra antiga já acertada. Diego: "tem tudo que avisar com 3 dias de
// antecedência ou ficar visível; desse jeito não vou saber." Agora cada conta vai com nome, valor e data,
// e a que entra na janela de 3 dias ganha um aviso próprio UMA vez (chave conta:<id>:<data>). A data entra
// na chave de propósito: conta recorrente que o Classic empurra pro mês seguinte volta a ser avisada.
// O aviso não mexe em nada: a conta continua em "A pagar" até alguém marcar como paga.

// Mesma regra do app (SEM_VENCIMENTO em nova.html). "Pago quando houver saldo" não tem prazo: a data do
// lançamento é o dia em que a dívida foi reconhecida. Avisar "venceu" disso é alerta que mente.
const SEM_VENCIMENTO = /(vencimento|data (exata )?de pagamento|data exata)[^.;]{0,60}n[ãa]o (informad|confirmad|definid)|sem vencimento|(assim que|quando)[^.;]{0,40}(houver|tiver) saldo|assim que poss[íi]vel|a pagar (ap[óo]s|depois d)|pagar (ap[óo]s|depois d)[^.;]{0,50}(servi[çc]o|entrega|receb)|quando (eu )?(tiver|receber) dinheiro/i;
const JANELA_DIAS = 3;
// Fora deste horário a varredura não manda aviso de conta: às 3h da manhã ele não paga nada. O que entrar na
// janela de madrugada sai no resumo das 07:30, que já chama cada conta pelo nome.
const HORA_INICIO_CONTAS = 8;
const HORA_FIM_CONTAS = 21;

function contasComPrazo(p: any): any[] {
  return (p.contas || []).filter((c: any) => !SEM_VENCIMENTO.test(String(c.descricao || "")));
}
const naJanela = (c: any) => Number(c.dias) >= 0 && Number(c.dias) <= JANELA_DIAS;
const chaveConta = (c: any) => `conta:${c.id}:${c.data}`;

// A descrição que o Classic grava é um parágrafo ("Vivo — mensalidade recorrente, vencimento todo dia 26.
// Valor-base R$ 69,00; ajustar..."). No aviso vai só o nome: o primeiro trecho antes de " — ", " - ", ". " ou ";".
function nomeConta(c: any): string {
  const t = String(c.descricao || "")
    .replace(/^(\[[^\]]*\]\s*)+/, "")                                   // tags internas: [EM MÃOS] etc.
    .replace(/^Pr[óo]xima ocorr[êe]ncia[^—–-]*[—–-]\s*/i, "")          // "Próxima ocorrência projetada — notebook..."
    .trim();
  const nome = t.split(/\s+[—–-]\s+|\.\s|;\s/)[0].trim() || c.categoria || "Conta";
  return nome.length > 36 ? nome.slice(0, 35).trimEnd() + "…" : nome;
}
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
function dataCurta(iso: string): string {
  const [a, m, d] = String(iso).split("-");
  const dia = new Date(Date.UTC(Number(a), Number(m) - 1, Number(d), 12)).getUTCDay();
  return `${SEMANA[dia]} ${d}/${m}`;
}
function quando(c: any): string {
  const dias = Number(c.dias);
  if (dias < 0) return `venceu ${dataCurta(c.data).slice(4)}`;
  if (dias === 0) return "vence hoje";
  if (dias === 1) return "vence amanhã";
  return `vence ${dataCurta(c.data)}`;
}
const linhaConta = (c: any) => `${nomeConta(c)} ${dinheiro(Number(c.valor))} (${quando(c)})`;

// No app, nota de material a prazo mora na aba Compras; o resto, em "A pagar". O toque abre a aba certa.
const ehMaterial = (c: any) => c.categoria === "Material";

function avisoContasD3(contas: any[]): Envio[] {
  if (!contas.length) return [];
  const chaves = contas.map(chaveConta);
  const soMaterial = contas.every(ehMaterial);
  const url = soMaterial ? "./nova.html?ir=compras" : "./nova.html?ir=futuro";
  if (contas.length === 1) {
    const c = contas[0];
    const q = quando(c);
    return [{ chaves, aviso: {
      titulo: `${nomeConta(c)} · ${dinheiro(Number(c.valor))}`,
      corpo: `${q[0].toUpperCase()}${q.slice(1)}${Number(c.dias) >= 2 ? "" : ` (${dataCurta(c.data)})`} · conta ${c.escopo === "pessoal" ? "pessoal" : "da empresa"}. Fica em ${soMaterial ? "Compras" : "A pagar"} até você marcar como paga.`,
      tag: `conta-${c.id}`,
      url,
    } }];
  }
  const ultima = contas.reduce((m, c) => (c.data > m ? c.data : m), contas[0].data);
  return [{ chaves, aviso: {
    titulo: `${contas.length} contas vencem até ${dataCurta(ultima)}`,
    corpo: contas.map(linhaConta).join(" · "),
    tag: "contas-d3",
    url,
  } }];
}

// Quantas contas o resumo chama pelo nome. Passando disso vira "+N" — mas a conta da janela D-3 que ficou de
// fora NÃO é marcada como avisada, e a varredura das 08:00 manda o aviso próprio dela.
const CONTAS_NO_RESUMO = 8;

function avisoDoResumo(p: any): Envio[] {
  const r = p.resumo || {};
  const partes: string[] = [];
  // Contas primeiro: é o único item do resumo que custa dinheiro se passar do dia.
  const contas = contasComPrazo(p);
  const nomeadas = contas.slice(0, CONTAS_NO_RESUMO);
  if (contas.length) {
    partes.push(`A pagar: ${nomeadas.map(linhaConta).join(" · ")}${contas.length > nomeadas.length ? ` +${contas.length - nomeadas.length}` : ""}`);
  }
  if (Number(r.retornos_vencidos) > 0) partes.push(`${r.retornos_vencidos} retorno(s) vencido(s)`);
  if (Number(r.caixa_pendente) > 0) partes.push(`${r.caixa_pendente} na caixa`);
  // Dia limpo não merece notificação. Notificação que não pede nada ensina a ignorar as que pedem.
  if (!partes.length && !Number(r.compromissos_hoje)) return [];
  const titulo = Number(r.compromissos_hoje) > 0
    ? `${r.compromissos_hoje} compromisso(s) hoje${r.proximo_hoje ? ` — o primeiro ${r.proximo_hoje}` : ""}`
    : "Hoje sem compromisso marcado";
  return [{
    chaves: [`resumo:${p.hoje}`],
    aviso: { titulo, corpo: partes.join(" · ") || "Nada pendente.", tag: "resumo-diario", url: "./nova.html" },
    // Contas da janela D-3 que o resumo já chamou pelo nome: contam como avisadas (ver o roteador).
    d3: nomeadas.filter(naJanela).map(chaveConta),
  }];
}

// ---------------------------------------------------------------- porta

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const doCorpo = req.method === "POST" ? await req.clone().json().catch(() => ({})) : {};
    const modo = url.searchParams.get("modo") || doCorpo.modo || "varredura";

    // A chave pública é pública por definição — o app precisa dela pra se inscrever. Sem segredo aqui.
    if (modo === "chave") {
      return Response.json({ chave_publica: (await vapid()).publica });
    }

    // RECIBO devolvido pelo service worker do aparelho. Sem segredo de propósito: o SW não tem a senha
    // (ela não pode viver num arquivo público) e o id é um uuid que só existe dentro da carga cifrada —
    // quem não recebeu a notificação não tem como adivinhar. Só carimba hora, não lê nem muda nada.
    // GET simples de propósito: POST com JSON dispara preflight CORS, e aí o SW precisaria de mais rede
    // justamente no momento em que o aparelho está com pressa pra voltar a dormir.
    if (modo === "recibo") {
      const id = String(url.searchParams.get("recibo") || doCorpo.recibo || "");
      const campo = String(url.searchParams.get("campo") || doCorpo.campo || "recebido");
      const cabecalhos = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
      if (!/^[0-9a-fA-F-]{36}$/.test(id)) return new Response(JSON.stringify({ erro: "recibo invalido" }), { status: 400, headers: cabecalhos });
      const achou = await rpc("push_recibo_marcar", { p_recibo: id, p_campo: campo });
      return new Response(JSON.stringify({ ok: achou }), { headers: cabecalhos });
    }

    const segredo = await rpc("push_segredo", { nome: "PUSH_SECRET" });
    if (!segredo || req.headers.get("x-push-secret") !== segredo) {
      return new Response(JSON.stringify({ erro: "sem autorizacao" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    if (modo === "teste") {
      const alvos = await assinaturasAtivas();
      const saidas = [];
      for (const alvo of alvos) {
        saidas.push({
          endpoint: alvo.endpoint.slice(0, 60) + "...",
          ...(await entregar(alvo, {
            titulo: "Teste do painel",
            corpo: "Se você está lendo isto, a notificação chega. " + new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" }),
            tag: "teste",
            url: "./nova.html",
          })),
        });
      }
      return Response.json({ modo, aparelhos: alvos.length, saidas });
    }

    const pendencias = await rpc("push_pendencias");

    // A RESERVA VEM ANTES DE MONTAR O TEXTO, não depois. Reservar antes é o que impede duas varreduras
    // cruzadas de mandarem o mesmo lembrete; fazer isso ANTES de montar é o que permite agrupar sem
    // repetir — o lote nasce só com o que ainda não foi notificado.
    let envios: Envio[] = [];
    let candidatos = 0;

    if (modo === "resumo") {
      const monta = avisoDoResumo(pendencias);
      candidatos = monta.length;
      if (monta.length) {
        const liberadas: string[] = await rpc("push_reservar", { chaves: monta[0].chaves });
        if (liberadas.length) {
          // As contas da janela D-3 que o resumo chamou pelo nome ficam marcadas como avisadas; senão a
          // varredura das 08:00 repetiria o mesmo aviso meia hora depois. Vão junto nas chaves do envio: se
          // nenhum aparelho receber, o `difundir` solta todas e a varredura tenta de novo.
          const d3 = monta[0].d3 || [];
          const d3Livres: string[] = d3.length ? await rpc("push_reservar", { chaves: d3 }) : [];
          monta[0].chaves.push(...d3Livres);
          envios = monta;
        }
      }
    } else {
      // Só a leva entra na reserva. Reservar as 6 horas inteiras marcaria como "já avisado" um
      // compromisso das 10:30 que ninguém viu ainda, e ele nunca ganharia lembrete.
      const leva = levaDaAgenda(pendencias.agenda || []);
      const caixa = pendencias.caixa || [];
      const hora = Number(String(pendencias.agora || "").slice(11, 13));
      const contas = hora >= HORA_INICIO_CONTAS && hora < HORA_FIM_CONTAS ? contasComPrazo(pendencias).filter(naJanela) : [];
      candidatos = leva.length + caixa.length + contas.length;
      if (candidatos) {
        const chaves = [...leva.map((a: any) => `agenda:${a.id}`), ...caixa.map((c: any) => `caixa:${c.id}`), ...contas.map(chaveConta)];
        const liberadas = new Set<string>(await rpc("push_reservar", { chaves }));
        envios = [
          ...avisosDaVarredura(
            leva.filter((a: any) => liberadas.has(`agenda:${a.id}`)),
            caixa.filter((c: any) => liberadas.has(`caixa:${c.id}`)),
          ),
          ...avisoContasD3(contas.filter((c: any) => liberadas.has(chaveConta(c)))),
        ];
      }
    }

    const relatorio = await difundir(envios);
    return Response.json({ modo, candidatos, envios: envios.length, relatorio, resumo: pendencias.resumo });
  } catch (e) {
    return new Response(JSON.stringify({ erro: String((e as Error)?.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

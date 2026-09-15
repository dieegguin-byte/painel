// Shared by the Deno Edge Function and the dependency-free Node tests.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERVICE_FIELDS = 'id,titulo,status,proxima_acao,prazo,profissional,responsavel,loja_material,data_entrega_material,materiais_necessarios';
const AGENDA_FIELDS = 'id,servico_id,titulo,data,hora,status';
const MAX_BODY_BYTES = 8192;
const MAX_UPSTREAM_BYTES = 262144;
const MAX_APPOINTMENTS = 100;

export class ConsultaError extends Error {
  constructor(status, codigo, mensagem) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

function failure(status, codigo, mensagem) {
  throw new ConsultaError(status, codigo, mensagem);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function publicKeyAllowed(key) {
  if (typeof key !== 'string' || key.length > 8192) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  // Legacy anon keys are supported; secret/service-role keys are never accepted.
  try {
    const parts = key.split('.');
    if (parts.length !== 3) return false;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64)).role === 'anon';
  } catch {
    return false;
  }
}

function normalizeConfig(config) {
  const url = new URL(config.supabaseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !publicKeyAllowed(config.publicKey)) {
    throw new Error('Invalid server configuration');
  }
  const origins = config.allowedOrigins;
  if (!Array.isArray(origins) || !origins.length || origins.some((origin) => {
    try {
      const parsed = new URL(origin);
      return parsed.origin !== origin || !['https:', 'http:'].includes(parsed.protocol);
    } catch { return true; }
  })) throw new Error('Invalid allowed origins');
  const timeoutMs = config.timeoutMs ?? 10000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error('Invalid timeout');
  return { supabaseUrl: url.origin, publicKey: config.publicKey, allowedOrigins: origins, timeoutMs };
}

async function readBounded(stream, maxBytes, error, timeoutMs) {
  if (!stream) throw error;
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  let timedOut = false;
  const timer = timeoutMs ? setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => {});
  }, timeoutMs) : null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (timedOut) failure(408, 'TEMPO_CORPO_ESGOTADO', 'O envio da consulta demorou mais que o permitido.');
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        throw error;
      }
      chunks.push(value);
    }
  } finally {
    if (timer !== null) clearTimeout(timer);
    reader.releaseLock();
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(joined);
}

export async function readInput(request, timeoutMs = 10000) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    failure(415, 'TIPO_INVALIDO', 'Envie a consulta como JSON.');
  }
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    failure(413, 'CORPO_MUITO_GRANDE', 'A consulta excede o tamanho permitido.');
  }
  let input;
  try {
    input = JSON.parse(await readBounded(request.body, MAX_BODY_BYTES,
      new ConsultaError(413, 'CORPO_MUITO_GRANDE', 'A consulta excede o tamanho permitido.'), timeoutMs));
  } catch (error) {
    if (error instanceof ConsultaError) throw error;
    failure(400, 'JSON_INVALIDO', 'A consulta precisa conter um JSON válido.');
  }
  if (!isObject(input) || Object.keys(input).some((key) => !['servico_id', 'pergunta'].includes(key)) ||
      typeof input.servico_id !== 'string' || !UUID.test(input.servico_id)) {
    failure(400, 'CONSULTA_INVALIDA', 'Selecione um serviço válido para consultar.');
  }
  if (input.pergunta !== undefined && (typeof input.pergunta !== 'string' || [...input.pergunta].length > 500)) {
    failure(400, 'PERGUNTA_INVALIDA', 'A pergunta deve ter no máximo 500 caracteres.');
  }
  return { servico_id: input.servico_id.toLowerCase(), pergunta: input.pergunta?.trim() || '' };
}

function tokenFrom(request) {
  const header = request.headers.get('authorization') || '';
  if (header.length > 8192 || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(header)) {
    failure(401, 'SESSAO_NECESSARIA', 'Entre no app para consultar este serviço.');
  }
  return header.slice(7);
}

async function readApi(config, token, path, fetchImpl, stage) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(config.supabaseUrl + path, {
      method: 'GET',
      headers: { apikey: config.publicKey, Authorization: `Bearer ${token}`, Accept: 'application/json',
        ...(stage === 'AGENDA' ? { Prefer: 'count=exact' } : {}) },
      signal: controller.signal,
      redirect: 'error',
      cache: 'no-store',
    });
    if (response.status === 401 || (stage === 'SESSAO' && [400, 403].includes(response.status))) {
      failure(401, 'SESSAO_INVALIDA', 'Sua sessão não pôde ser validada. Entre novamente no app.');
    }
    if (response.status === 403) failure(403, 'ACESSO_NEGADO', 'Esta conta não tem acesso à consulta.');
    if (!response.ok) failure(502, `CONSULTA_${stage}_FALHOU`, 'Não foi possível concluir a leitura. Tente novamente.');
    const text = await readBounded(response.body, MAX_UPSTREAM_BYTES,
      new ConsultaError(502, `CONSULTA_${stage}_FALHOU`, 'A leitura excedeu o limite desta consulta.'));
    const data = JSON.parse(text);
    if (stage === 'AGENDA') {
      const range = response.headers.get('content-range') || '';
      const total = /^(?:\d+-\d+|\*)\/(\d+)$/.exec(range)?.[1];
      if (total === undefined || !Number.isSafeInteger(Number(total))) {
        failure(502, 'CONSULTA_AGENDA_FALHOU', 'Não foi possível verificar se a leitura da agenda está completa.');
      }
      return { data, total: Number(total) };
    }
    return data;
  } catch (error) {
    if (error instanceof ConsultaError) throw error;
    if (controller.signal.aborted) failure(504, `TEMPO_${stage}_ESGOTADO`, 'A leitura demorou mais que o permitido. Tente novamente.');
    failure(502, `CONSULTA_${stage}_FALHOU`, 'Não foi possível concluir a leitura. Tente novamente.');
  } finally {
    clearTimeout(timer);
  }
}

function nullableText(value) {
  return typeof value === 'string' ? value : null;
}

function serviceProjection(row, observations) {
  const service = { id: row.id, titulo: row.titulo, status: row.status };
  for (const key of ['proxima_acao', 'prazo', 'profissional', 'responsavel', 'loja_material', 'data_entrega_material']) {
    service[key] = nullableText(row[key]);
  }
  if (!Array.isArray(row.materiais_necessarios)) {
    service.materiais_necessarios = null;
    observations.push('O campo de materiais tem um formato que este piloto não interpreta.');
  } else {
    // Preserve recorded values without deriving arrival, availability or a purchase obligation.
    const keys = ['item', 'material', 'estado', 'status', 'comprado', 'pedido', 'arquivado', 'quantidade', 'unidade', 'quantidade_status', 'disponibilidade_status'];
    service.materiais_necessarios = row.materiais_necessarios.map((material) => {
      if (!isObject(material)) return { registro_nao_interpretado: true };
      return Object.fromEntries(keys.filter((key) => Object.hasOwn(material, key) &&
        (material[key] === null || ['string', 'number', 'boolean'].includes(typeof material[key])))
        .map((key) => [key, material[key]]));
    });
  }
  return service;
}

/** Reads a single service only after a real session and the existing allowlist check succeed. */
export async function consultarServico({ config, token, servicoId, pergunta = '', fetchImpl = fetch, now = () => new Date() }) {
  if (!UUID.test(servicoId)) failure(400, 'CONSULTA_INVALIDA', 'Selecione um serviço válido para consultar.');
  const user = await readApi(config, token, '/auth/v1/user', fetchImpl, 'SESSAO');
  if (!isObject(user) || typeof user.id !== 'string' || !UUID.test(user.id)) {
    failure(502, 'CONSULTA_SESSAO_FALHOU', 'Não foi possível validar a sessão. Tente novamente.');
  }
  // This existing SQL STABLE function only checks usuarios_autorizados against auth.uid().
  const allowed = await readApi(config, token, '/rest/v1/rpc/usuario_autorizado', fetchImpl, 'AUTORIZACAO');
  if (allowed === false) failure(403, 'ACESSO_NEGADO', 'Esta conta não está autorizada a consultar o app.');
  if (allowed !== true) failure(502, 'CONSULTA_AUTORIZACAO_FALHOU', 'Não foi possível verificar o acesso. Tente novamente.');

  const serviceQuery = new URLSearchParams({ select: SERVICE_FIELDS, id: `eq.${servicoId}`, limit: '2' });
  const services = await readApi(config, token, `/rest/v1/servicos?${serviceQuery}`, fetchImpl, 'SERVICO');
  if (Array.isArray(services) && services.length === 0) failure(404, 'SERVICO_NAO_ENCONTRADO', 'O serviço não foi encontrado ou não está disponível para esta conta.');
  if (!Array.isArray(services) || services.length !== 1 || !isObject(services[0]) || services[0].id !== servicoId ||
      typeof services[0].titulo !== 'string' || typeof services[0].status !== 'string') {
    failure(502, 'CONSULTA_SERVICO_FALHOU', 'Não foi possível confirmar os dados deste serviço.');
  }
  const agendaQuery = new URLSearchParams({
    select: AGENDA_FIELDS, servico_id: `eq.${servicoId}`, status: 'eq.planejado',
    order: 'data.asc,hora.asc.nullslast,id.asc', limit: String(MAX_APPOINTMENTS + 1),
  });
  const agenda = await readApi(config, token, `/rest/v1/agenda?${agendaQuery}`, fetchImpl, 'AGENDA');
  const appointments = agenda.data;
  if (!Array.isArray(appointments) || appointments.some((row) => !isObject(row) || !UUID.test(row.id) ||
      row.servico_id !== servicoId || row.status !== 'planejado' || typeof row.titulo !== 'string' ||
      typeof row.data !== 'string' || (row.hora !== null && typeof row.hora !== 'string'))) {
    failure(502, 'CONSULTA_AGENDA_FALHOU', 'Não foi possível confirmar a leitura da agenda vinculada.');
  }
  if (agenda.total > MAX_APPOINTMENTS || appointments.length > MAX_APPOINTMENTS) {
    failure(422, 'LIMITE_COMPROMISSOS', 'O serviço possui mais compromissos do que este piloto consegue apresentar em uma consulta.');
  }
  if (agenda.total !== appointments.length) {
    failure(502, 'CONSULTA_AGENDA_FALHOU', 'A agenda retornou uma leitura parcial. Tente novamente.');
  }

  const observacoes = [];
  const servico = serviceProjection(services[0], observacoes);
  const compromissos = appointments.map(({ id, titulo, data, hora, status }) => ({ id, titulo, data, hora, status }));
  const resumo = `Status registrado: ${servico.status}. Próxima ação registrada: ${servico.proxima_acao || 'não informada'}. ` +
    `Prazo registrado: ${servico.prazo || 'não informado'}. Registros vinculados com status planejado: ${compromissos.length}.`;
  if (pergunta) observacoes.push('Este piloto apresentou os registros disponíveis. A pergunta ainda não foi interpretada por IA.');
  return {
    ok: true, modo: 'regras', consultado_em: now().toISOString(), servico, compromissos, resumo, observacoes,
    limites: [
      'Consulta de um serviço e dos registros de agenda diretamente vinculados a ele.',
      'Não consulta remarcações na caixa de entrada; a lista pode diferir da agenda operacional exibida pelo app.',
      'Status planejado e datas registradas não confirmam que um compromisso aconteceu.',
      'Campos vazios não comprovam erro, atraso ou necessidade de ação. Materiais são exibidos como registrados.',
    ],
  };
}

export function createHandler(rawConfig, dependencies = {}) {
  let config;
  try { config = normalizeConfig(rawConfig); } catch { /* Fail closed, without printing configuration. */ }
  const fetchImpl = dependencies.fetch || globalThis.fetch;
  const now = dependencies.now || (() => new Date());
  return async function handler(request) {
    const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin' });
    const respond = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status, headers });
    const origin = request.headers.get('origin');
    try {
      if (!config) failure(503, 'AGENTE_INDISPONIVEL', 'A consulta ainda não está configurada neste ambiente.');
      if (origin && !config.allowedOrigins.includes(origin)) failure(403, 'ORIGEM_NEGADA', 'Esta origem não está autorizada.');
      if (origin) headers.set('Access-Control-Allow-Origin', origin);
      if (request.method === 'OPTIONS') {
        if (request.headers.get('access-control-request-method') !== 'POST') failure(405, 'METODO_INVALIDO', 'Use POST para consultar.');
        headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
        headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info');
        headers.set('Access-Control-Max-Age', '600');
        return respond(null, 204);
      }
      if (request.method !== 'POST') { headers.set('Allow', 'POST, OPTIONS'); failure(405, 'METODO_INVALIDO', 'Use POST para consultar.'); }
      const token = tokenFrom(request);
      const input = await readInput(request, config.timeoutMs);
      let report = await consultarServico({ config, token, servicoId: input.servico_id, pergunta: input.pergunta, fetchImpl, now });
      // The model is called only after authorization and a complete read, on an explicit question.
      if (input.pergunta && typeof dependencies.explain === 'function') {
        try { report = await dependencies.explain(report, input.pergunta); }
        catch { report = { ...report, limites: [...report.limites, 'A explicação por IA falhou. Os registros consultados foram preservados.'] }; }
      }
      return respond(report);
    } catch (error) {
      const known = error instanceof ConsultaError;
      return respond({ ok: false, erro: { codigo: known ? error.codigo : 'CONSULTA_FALHOU',
        mensagem: known ? error.message : 'Não foi possível concluir a consulta. Tente novamente.' } }, known ? error.status : 500);
    }
  };
}

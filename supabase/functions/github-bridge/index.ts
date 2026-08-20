// ============================================================================
// github-bridge — o executor da ponte Classic → GitHub
//
// O ChatGPT Classic não consegue escrever no GitHub (403 "Resource not
// accessible by integration" em tudo: branch, arquivo, issue). Então ele não
// escreve: ele enfileira. Uma linha em public.github_change_requests, um gatilho
// pg_net acorda esta função, e é ELA quem fala com o GitHub.
//
// O token do GitHub existe só aqui dentro, vindo dos Secrets. Ele nunca passa
// pelo ChatGPT, pelo navegador, pelo nova.html nem pelo Drive.
//
// O QUE ESTA FUNÇÃO NUNCA FAZ:
//   - escrever na main (a branch de saída é sempre classic/…)
//   - fazer merge (o PR fica esperando o Diego)
//   - tocar em qualquer repositório fora da allowlist
//   - executar comando/shell vindo do pedido
//
// Ver migracoes/2026-08-20_ponte_classic_github.sql para as travas do banco.
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const REPOSITORIOS_PERMITIDOS = ["dieegguin-byte/painel"];
const PREFIXO_BRANCH = "classic/";
const MAX_ARQUIVOS = 20;
const MAX_BYTES_ARQUIVO = 1_572_864; // 1,5 MB
const MAX_BYTES_TOTAL = 3_145_728; // 3 MB
const GITHUB_API = "https://api.github.com";

// ---------------------------------------------------------------------------
// utilidades
// ---------------------------------------------------------------------------

/** Nunca deixar o token aparecer numa mensagem de erro que volta pro banco. */
function limpaSegredo(texto: string, ...segredos: (string | undefined)[]): string {
  let saida = texto;
  for (const s of segredos) {
    if (s && s.length > 6) saida = saida.split(s).join("«oculto»");
  }
  return saida;
}

/** base64 de UTF-8, em pedaços pra aguentar arquivo de centenas de KB. */
function paraBase64(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let binario = "";
  const passo = 0x8000;
  for (let i = 0; i < bytes.length; i += passo) {
    binario += String.fromCharCode(...bytes.subarray(i, i + passo));
  }
  return btoa(binario);
}

/** Nome de branch determinístico: o mesmo pedido sempre aponta pra mesma branch. */
function montaBranch(idempotencyKey: string, id: string): string {
  const slug = idempotencyKey
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "pedido";
  return `${PREFIXO_BRANCH}${slug}-${id.slice(0, 8)}`;
}

function validaCaminho(caminho: string): string | null {
  if (!caminho || !caminho.trim()) return "arquivo sem path";
  if (caminho.startsWith("/")) return `path absoluto: ${caminho}`;
  if (caminho.includes("..")) return `path com traversal: ${caminho}`;
  if (caminho.includes("\\")) return `path com barra invertida: ${caminho}`;
  if (caminho.startsWith(".git/")) return `path no encanamento do git: ${caminho}`;
  if (caminho.startsWith(".github/workflows/")) return `workflow do Actions fora do alcance: ${caminho}`;
  if (caminho.length > 200) return `path longo demais: ${caminho.length} caracteres`;
  return null;
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

class ErroGitHub extends Error {
  constructor(public status: number, public detalhe: string) {
    super(`GitHub ${status}: ${detalhe}`);
  }
}

async function github(
  token: string,
  metodo: string,
  caminho: string,
  corpo?: unknown,
): Promise<{ status: number; dados: any }> {
  const resposta = await fetch(`${GITHUB_API}${caminho}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "tapecaria-bahia-ponte-classic",
      ...(corpo ? { "Content-Type": "application/json" } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

  const texto = await resposta.text();
  let dados: any = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = { raw: texto.slice(0, 500) };
  }
  return { status: resposta.status, dados };
}

async function exigeOk(
  token: string,
  metodo: string,
  caminho: string,
  corpo?: unknown,
): Promise<any> {
  const { status, dados } = await github(token, metodo, caminho, corpo);
  if (status < 200 || status >= 300) {
    const msg = dados?.message ?? JSON.stringify(dados)?.slice(0, 300) ?? "sem detalhe";
    const erros = dados?.errors ? ` (${JSON.stringify(dados.errors).slice(0, 200)})` : "";
    throw new ErroGitHub(status, `${msg}${erros} [${metodo} ${caminho}]`);
  }
  return dados;
}

// ---------------------------------------------------------------------------
// o trabalho de verdade
// ---------------------------------------------------------------------------

interface Arquivo {
  path: string;
  content: string;
  expected_sha?: string | null;
}

async function processaPedido(pedido: any, token: string) {
  const [owner, repo] = pedido.repository.split("/");
  const base = pedido.base_branch || "main";
  const branch = montaBranch(pedido.idempotency_key, pedido.id);

  if (!REPOSITORIOS_PERMITIDOS.includes(pedido.repository)) {
    throw new Error(`repositório não autorizado: ${pedido.repository}`);
  }
  if (branch === base || !branch.startsWith(PREFIXO_BRANCH)) {
    throw new Error(`branch de saída inválida: ${branch}`);
  }

  // --- validação do payload (o banco já barrou; aqui é a segunda tranca) ---
  const arquivos: Arquivo[] = pedido.arquivos;
  if (!Array.isArray(arquivos) || arquivos.length === 0) {
    throw new Error("pedido sem arquivos");
  }
  if (arquivos.length > MAX_ARQUIVOS) {
    throw new Error(`${arquivos.length} arquivos; o limite é ${MAX_ARQUIVOS}`);
  }
  let total = 0;
  for (const a of arquivos) {
    const problema = validaCaminho(a.path);
    if (problema) throw new Error(problema);
    if (typeof a.content !== "string") throw new Error(`arquivo ${a.path} sem content`);
    const bytes = new TextEncoder().encode(a.content).length;
    if (bytes > MAX_BYTES_ARQUIVO) {
      throw new Error(`arquivo ${a.path} tem ${bytes} bytes; o limite é ${MAX_BYTES_ARQUIVO}`);
    }
    total += bytes;
  }
  if (total > MAX_BYTES_TOTAL) {
    throw new Error(`pedido com ${total} bytes; o limite é ${MAX_BYTES_TOTAL}`);
  }

  // --- a branch já existe? então este pedido já rodou (retentativa) ---
  const refExistente = await github(token, "GET", `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  if (refExistente.status === 200) {
    const prs = await exigeOk(
      token,
      "GET",
      `/repos/${owner}/${repo}/pulls?head=${owner}:${branch}&state=all`,
    );
    if (Array.isArray(prs) && prs.length > 0) {
      return {
        branch,
        commit_sha: refExistente.dados?.object?.sha ?? null,
        pr_number: prs[0].number,
        pr_url: prs[0].html_url,
        reaproveitado: true,
      };
    }
    throw new Error(
      `a branch ${branch} já existe no GitHub mas não tem PR. Confira à mão antes de repetir o pedido.`,
    );
  }

  // --- ponto de partida ---
  const refBase = await exigeOk(token, "GET", `/repos/${owner}/${repo}/git/ref/heads/${base}`);
  const shaBase: string = refBase.object.sha;

  // --- conferência de versão: ninguém sobrescreve mudança nova sem saber ---
  for (const a of arquivos) {
    if (!a.expected_sha) continue;
    const atual = await github(
      token,
      "GET",
      `/repos/${owner}/${repo}/contents/${encodeURI(a.path)}?ref=${encodeURIComponent(base)}`,
    );
    if (atual.status === 404) {
      throw new Error(
        `${a.path}: o pedido veio com expected_sha mas o arquivo não existe em ${base}`,
      );
    }
    if (atual.status !== 200) {
      throw new ErroGitHub(atual.status, `não deu pra conferir ${a.path}`);
    }
    if (atual.dados.sha !== a.expected_sha) {
      throw new Error(
        `${a.path} mudou em ${base} desde que o pedido foi montado ` +
          `(esperado ${a.expected_sha.slice(0, 8)}, está ${String(atual.dados.sha).slice(0, 8)}). ` +
          `Releia o arquivo e refaça o pedido.`,
      );
    }
  }

  // --- blobs → tree → commit → branch ---
  const itensTree = [];
  for (const a of arquivos) {
    const blob = await exigeOk(token, "POST", `/repos/${owner}/${repo}/git/blobs`, {
      content: paraBase64(a.content),
      encoding: "base64",
    });
    itensTree.push({ path: a.path, mode: "100644", type: "blob", sha: blob.sha });
  }

  const commitBase = await exigeOk(token, "GET", `/repos/${owner}/${repo}/git/commits/${shaBase}`);
  const tree = await exigeOk(token, "POST", `/repos/${owner}/${repo}/git/trees`, {
    base_tree: commitBase.tree.sha,
    tree: itensTree,
  });

  const mensagem =
    `${pedido.commit_message}\n\n${pedido.motivo}\n\n` +
    `Pedido ${pedido.id} pela ponte Classic (${pedido.solicitado_por}).`;

  const commit = await exigeOk(token, "POST", `/repos/${owner}/${repo}/git/commits`, {
    message: mensagem,
    tree: tree.sha,
    parents: [shaBase],
  });

  await exigeOk(token, "POST", `/repos/${owner}/${repo}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: commit.sha,
  });

  // --- o Pull Request. Merge continua sendo decisão do Diego. ---
  const corpoPr = [
    `**Motivo:** ${pedido.motivo}`,
    "",
    `Pedido pela ponte Classic → GitHub por \`${pedido.solicitado_por}\`.`,
    `Id do pedido: \`${pedido.id}\``,
    `Chave de idempotência: \`${pedido.idempotency_key}\``,
    "",
    `Arquivos: ${arquivos.map((a) => `\`${a.path}\``).join(", ")}`,
    "",
    "---",
    "_Aberto automaticamente. Nada foi mesclado — revisar antes de aceitar._",
  ].join("\n");

  const pr = await exigeOk(token, "POST", `/repos/${owner}/${repo}/pulls`, {
    title: pedido.commit_message,
    head: branch,
    base,
    body: corpoPr,
    maintainer_can_modify: true,
  });

  return {
    branch,
    commit_sha: commit.sha,
    pr_number: pr.number,
    pr_url: pr.html_url,
    reaproveitado: false,
  };
}

// ---------------------------------------------------------------------------
// entrada
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const bridgeSecret = Deno.env.get("BRIDGE_SECRET");
  const githubToken = Deno.env.get("GITHUB_TOKEN");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  const responde = (corpo: unknown, status = 200) =>
    new Response(JSON.stringify(corpo), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  // --- porta ---
  if (!bridgeSecret) {
    return responde({ erro: "BRIDGE_SECRET não configurado nos Secrets da função" }, 500);
  }
  const enviado = req.headers.get("x-bridge-secret");
  if (enviado !== bridgeSecret) {
    return responde({ erro: "não autorizado" }, 401);
  }
  if (!supabaseUrl || !serviceRole) {
    return responde({ erro: "ambiente do Supabase incompleto" }, 500);
  }

  const db = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

  let corpo: any = {};
  try {
    corpo = await req.json();
  } catch {
    corpo = {};
  }

  // Quais pedidos atender: um específico, ou tudo que está parado.
  let ids: string[] = [];
  if (corpo.request_id) {
    ids = [corpo.request_id];
  } else if (corpo.action === "drain") {
    const { data } = await db
      .from("github_change_requests")
      .select("id")
      .eq("status", "pendente")
      .order("criado_em", { ascending: true })
      .limit(10);
    ids = (data ?? []).map((l: any) => l.id);
  } else {
    return responde({ erro: 'informe {"request_id": "..."} ou {"action": "drain"}' }, 400);
  }

  if (!githubToken) {
    for (const id of ids) {
      await db
        .from("github_change_requests")
        .update({
          status: "erro",
          erro: "GITHUB_TOKEN não configurado nos Secrets da função",
          processado_em: new Date().toISOString(),
        })
        .eq("id", id);
    }
    return responde({ erro: "GITHUB_TOKEN não configurado nos Secrets da função" }, 500);
  }

  const relatorio = [];

  for (const id of ids) {
    // Reivindicação atômica: só um processamento por pedido, mesmo com dois
    // disparos chegando juntos. Quem não conseguir o UPDATE não faz nada.
    const { data: reivindicado } = await db
      .from("github_change_requests")
      .update({ status: "processando" })
      .eq("id", id)
      .in("status", ["pendente", "erro"])
      .select()
      .maybeSingle();

    if (!reivindicado) {
      const { data: atual } = await db
        .from("github_change_requests")
        .select("id, status, branch, pr_url, erro")
        .eq("id", id)
        .maybeSingle();
      relatorio.push({
        id,
        pulado: atual ? `já está ${atual.status}` : "não encontrado",
        pr_url: atual?.pr_url ?? null,
      });
      continue;
    }

    try {
      const r = await processaPedido(reivindicado, githubToken);
      await db
        .from("github_change_requests")
        .update({
          status: "concluido",
          branch: r.branch,
          commit_sha: r.commit_sha,
          pr_number: r.pr_number,
          pr_url: r.pr_url,
          erro: null,
          tentativas: (reivindicado.tentativas ?? 0) + 1,
          processado_em: new Date().toISOString(),
        })
        .eq("id", id);
      relatorio.push({ id, status: "concluido", ...r });
    } catch (e) {
      const msg = limpaSegredo(
        e instanceof Error ? e.message : String(e),
        githubToken,
        bridgeSecret,
        serviceRole,
      );
      await db
        .from("github_change_requests")
        .update({
          status: "erro",
          erro: msg.slice(0, 2000),
          tentativas: (reivindicado.tentativas ?? 0) + 1,
          processado_em: new Date().toISOString(),
        })
        .eq("id", id);
      relatorio.push({ id, status: "erro", erro: msg.slice(0, 500) });
    }
  }

  return responde({ processados: relatorio.length, relatorio });
});

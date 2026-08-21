import { withSupabase } from "npm:@supabase/server@1.4.1";

const FIELDS = {
  clientes: "id,cidade,criado_em",
  servicos: "id,cliente_id,status,prioridade,prazo,proxima_acao,profissional,loja_material,data_entrega_material,materiais_necessarios,tracking_ref,origem_plataforma,origem_campanha_id,origem_grupo_id,origem_anuncio_id,origem_palavra_chave,origem_match_type,origem_dispositivo,gclid,utm_source,utm_medium,utm_campaign,utm_content,utm_term,landing_page,origem_primeiro_toque,origem_ultimo_toque,gbraid,wbraid",
  agenda: "id,servico_id,data,hora,status,google_event_id,cidade,tipo",
  financeiro: "id,tipo,escopo,categoria,valor,status,data,fornecedor_id,servico_id,agenda_id",
} as const;

function validDate(value: string | null): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export default {
  fetch: withSupabase({ auth: "user", cors: "default" }, async (req, ctx) => {
    if (req.method !== "GET") return Response.json({ error: "method_not_allowed" }, { status: 405 });

    const userId = String(ctx.userClaims?.id ?? "").trim();
    if (!userId) return Response.json({ error: "forbidden" }, { status: 403 });

    const { data: allowed, error: allowError } = await ctx.supabase
      .from("usuarios_autorizados")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (allowError || !allowed) return Response.json({ error: "forbidden" }, { status: 403 });

    const url = new URL(req.url);
    const fromDate = validDate(url.searchParams.get("from"));
    const requestedLimit = Number(url.searchParams.get("limit") ?? "500");
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(500, Math.trunc(requestedLimit))) : 500;

    const read = async (table: keyof typeof FIELDS, dateField?: "data") => {
      let query = ctx.supabase.from(table).select(FIELDS[table]).limit(limit);
      if (fromDate && dateField) query = query.gte(dateField, fromDate);
      const { data, error } = await query;
      if (error) throw new Error(`shadow_read_failed:${table}`);
      return data ?? [];
    };

    try {
      const [clients, services, agenda, finance] = await Promise.all([
        read("clientes"),
        read("servicos"),
        read("agenda", "data"),
        read("financeiro", "data"),
      ]);

      return Response.json({
        mode: "shadow-read",
        captured_at: new Date().toISOString(),
        clients,
        services,
        agenda,
        finance,
      }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return Response.json({ error: "shadow_read_failed" }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }
  }),
};

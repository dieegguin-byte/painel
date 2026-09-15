import { createHandler } from './core.mjs';
import { createExplainer } from './provider.mjs';

const explain = createExplainer(Deno.env.get('AGENTE_IA_ENABLED') === 'true' ? {
  apiKey: Deno.env.get('OPENAI_API_KEY') || '',
  model: Deno.env.get('OPENAI_MODEL') || '',
} : {});

// Uses the caller's session and the existing RLS rules. Never use a service-role key here.
const handler = createHandler({
  supabaseUrl: Deno.env.get('SUPABASE_URL') || '',
  publicKey: Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '',
  allowedOrigins: (Deno.env.get('AGENTE_ALLOWED_ORIGINS') || '').split(',').map((value) => value.trim()).filter(Boolean),
}, { explain });

Deno.serve(handler);

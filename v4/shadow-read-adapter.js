'use strict';
// V4 shadow read adapter. No Supabase SDK here and no mutation method is accepted.
// The caller must inject a capability object exposing ONLY select(table, fields, options).
const FIELDS={
  clientes:'id,cidade,criado_em',
  servicos:'id,cliente_id,status,prioridade,prazo,proxima_acao,profissional,loja_material,data_entrega_material,materiais_necessarios,tracking_ref,origem_plataforma,origem_campanha_id,origem_grupo_id,origem_anuncio_id,origem_palavra_chave,origem_match_type,origem_dispositivo,gclid,utm_source,utm_medium,utm_campaign,utm_content,utm_term,landing_page,origem_primeiro_toque,origem_ultimo_toque,gbraid,wbraid',
  agenda:'id,servico_id,data,hora,status,google_event_id,cidade,tipo',
  financeiro:'id,tipo,escopo,categoria,valor,status,data,fornecedor_id,servico_id,agenda_id'
};
function assertReadClient(client){
  if(!client||typeof client.select!=='function')throw new Error('shadow_client_read_only_required');
  const forbidden=['insert','update','delete','upsert','rpc','mutate','write'];
  for(const k of forbidden)if(typeof client[k]==='function')throw new Error('shadow_client_has_write_capability');
  return client;
}
async function loadShadowSnapshot(client,{fromDate=null,limit=500}={}){
  const c=assertReadClient(client);
  const q=(table,fields,opts={})=>c.select(table,fields,{...opts,limit});
  const [clientes,servicos,agenda,financeiro]=await Promise.all([
    q('clientes',FIELDS.clientes),
    q('servicos',FIELDS.servicos),
    q('agenda',FIELDS.agenda,fromDate?{gte:{data:fromDate}}:{}),
    q('financeiro',FIELDS.financeiro,fromDate?{gte:{data:fromDate}}:{})
  ]);
  return {captured_at:new Date().toISOString(),source:'supabase-shadow-read',clients:clientes,services:servicos,agenda,finance:financeiro};
}
module.exports={FIELDS,assertReadClient,loadShadowSnapshot};

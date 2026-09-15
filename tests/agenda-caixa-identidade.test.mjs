import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { before, after, beforeEach, test, describe } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const USER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLIENT='10000000-0000-4000-8000-000000000001';
const BAD='10000000-0000-4000-8000-000000000002';
const SERVICE='20000000-0000-4000-8000-000000000001';
const BOX='30000000-0000-4000-8000-000000000001';
const OTHERBOX='30000000-0000-4000-8000-000000000002';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const helperContext=vm.createContext({});
vm.runInContext(await read('agenda-caixa.js'),helperContext);
const helper=helperContext.BahiaAgendaCaixa;

describe('Caixa -> Agenda — PostgreSQL local, sem conexão externa',()=>{
  let pg;
  before(async()=>{
    pg=await PGlite.create();
    await pg.exec(`
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
      CREATE SCHEMA auth; CREATE SCHEMA private;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      GRANT USAGE ON SCHEMA auth TO authenticated;
      CREATE FUNCTION public.usuario_autorizado() RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(auth.uid()='${USER}'::uuid,false) $$;
      CREATE TABLE public.clientes(id uuid PRIMARY KEY, nome text, telefone text);
      CREATE TABLE public.servicos(id uuid PRIMARY KEY, cliente_id uuid REFERENCES clientes, titulo text, status text);
      CREATE TABLE public.caixa_entrada(id uuid PRIMARY KEY, texto text, conversa jsonb DEFAULT '[]', processado boolean DEFAULT false, status text DEFAULT 'novo');
      CREATE TABLE public.agenda(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cliente_id uuid REFERENCES clientes, servico_id uuid REFERENCES servicos, titulo text, data date, hora time, tipo text, cidade text, status text);
      CREATE FUNCTION private.whatsapp_phone_ok(t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT t IS NOT NULL AND regexp_replace(t,'\\D','','g') ~ '^55[1-9][0-9]9[6-9][0-9]{7}$' $$;
      CREATE FUNCTION private.trg_agenda_servico_exige_whatsapp() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN new; END $$;
      CREATE TRIGGER agenda_servico_exige_whatsapp BEFORE INSERT OR UPDATE OF servico_id,status ON public.agenda FOR EACH ROW EXECUTE FUNCTION private.trg_agenda_servico_exige_whatsapp();
      ${['clientes','servicos','caixa_entrada','agenda'].map(t=>`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY; GRANT SELECT,INSERT,UPDATE,DELETE ON public.${t} TO authenticated; CREATE POLICY operador ON public.${t} TO authenticated USING (public.usuario_autorizado()) WITH CHECK (public.usuario_autorizado());`).join('\n')}
    `);
    await pg.exec(await read('migracoes/20260915153735_agenda_caixa_identidade.sql'));
  });
  after(async()=>{await pg?.close();});
  beforeEach(async()=>{
    await pg.exec('RESET ROLE; TRUNCATE agenda,caixa_entrada,servicos,clientes;');
    await pg.query('INSERT INTO clientes VALUES ($1,$2,$3),($4,$5,$6)',[CLIENT,'Nome repetido','+55 61 99999-9999',BAD,'Nome repetido','+55 61 9671-8270']);
    await pg.query('INSERT INTO servicos VALUES ($1,$2,$3,$4)',[SERVICE,CLIENT,'Serviço fictício','lead']);
    await pg.query('INSERT INTO caixa_entrada(id,texto) VALUES ($1,$2),($3,$4)',[BOX,'Entrada fictícia',OTHERBOX,'Entrada fictícia']);
    await pg.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[USER]);
    await pg.exec('SET ROLE authenticated');
  });
  const create=async(overrides={})=>{
    const x={box:BOX,natureza:'cliente',cliente:CLIENT,servico:SERVICE,titulo:'Follow-up fictício',data:'2026-09-16',hora:'14:00',tipo:'remoto',cidade:null,...overrides};
    return (await pg.query('SELECT public.agenda_criar_da_caixa($1,$2,$3,$4,$5,$6,$7,$8,$9) AS row',[x.box,x.natureza,x.cliente,x.servico,x.titulo,x.data,x.hora,x.tipo,x.cidade])).rows[0].row;
  };
  const count=async()=>(await pg.query('SELECT count(*)::int AS n FROM agenda')).rows[0].n;

  test('telefone inválido sem serviço não gera Agenda nem resolve Caixa',async()=>{
    await assert.rejects(create({cliente:BAD,servico:null}),/WhatsApp válido/);
    assert.equal(await count(),0);
    assert.equal((await pg.query('SELECT processado FROM caixa_entrada WHERE id=$1',[BOX])).rows[0].processado,false);
  });
  test('bloqueio explícito não pode ser contornado como avulso nem com IDs válidos',async()=>{
    await pg.query('UPDATE caixa_entrada SET texto=$1 WHERE id=$2',['BLOQUEIO DE CADASTRO — caso fictício',BOX]);
    await assert.rejects(create(),/Cadastro bloqueado/);
    await assert.rejects(create({natureza:'avulso',cliente:null,servico:null}),/Cadastro bloqueado/);
    assert.equal(await count(),0);
  });
  test('cliente e serviço válidos retornam IDs da linha salva e origem correta',async()=>{
    const saved=await create();
    assert.equal(saved.cliente_id,CLIENT);assert.equal(saved.servico_id,SERVICE);assert.equal(saved.caixa_entrada_id,BOX);
    assert.deepEqual((await pg.query('SELECT to_jsonb(a) AS row FROM agenda a WHERE id=$1',[saved.id])).rows[0].row,saved);
  });
  test('resolução estruturada libera identidade validada preservando histórico, sem liberar avulso',async()=>{
    const conversa=[{texto:'BLOQUEIO DE CADASTRO — falta confirmar número'},{meta:{tipo_operacional:'cadastro_validado',cliente_id:CLIENT,telefone_confirmado:'+55 61 99999-9999'}}];
    await pg.query('UPDATE caixa_entrada SET texto=$1,conversa=$2 WHERE id=$3',['BLOQUEIO DE CADASTRO — histórico',JSON.stringify(conversa),BOX]);
    await assert.rejects(create({natureza:'avulso',cliente:null,servico:null}),/Confirmação de cadastro/);
    assert.equal((await create()).cliente_id,CLIENT);
    assert.deepEqual((await pg.query('SELECT conversa FROM caixa_entrada WHERE id=$1',[BOX])).rows[0].conversa,conversa);
  });
  test('resolução incompatível e novo bloqueio depois da confirmação impedem Agenda',async()=>{
    const confirmacao={meta:{tipo_operacional:'cadastro_validado',cliente_id:CLIENT,telefone_confirmado:'+55 61 99888-8888'}};
    await pg.query('UPDATE caixa_entrada SET texto=$1,conversa=$2 WHERE id=$3',['BLOQUEIO DE CADASTRO',JSON.stringify([confirmacao]),BOX]);
    await assert.rejects(create(),/Confirmação de cadastro/);
    confirmacao.meta.telefone_confirmado='+55 61 99999-9999';
    await pg.query('UPDATE caixa_entrada SET conversa=$1 WHERE id=$2',[JSON.stringify([confirmacao,{meta:{tipo_operacional:'cadastro_bloqueado'}}]),BOX]);
    await assert.rejects(create(),/Cadastro bloqueado/);assert.equal(await count(),0);
  });
  test('cliente válido sem serviço e FK de serviço sem cliente informado funcionam',async()=>{
    assert.equal((await create({servico:null})).cliente_id,CLIENT);
    assert.equal((await create({box:OTHERBOX,cliente:null})).cliente_id,CLIENT);
  });
  test('IDs conflitantes ou ausentes nunca são casados pelo nome',async()=>{
    await assert.rejects(create({cliente:BAD}),/não corresponde/);
    await assert.rejects(create({cliente:null,servico:null}),/Escolha um cliente/);
    assert.equal(await count(),0);
  });
  test('avulsos/pessoais/operacionais continuam sem cliente',async()=>{
    for(const natureza of ['avulso','pessoal','operacional']){
      const box=(await pg.query("INSERT INTO caixa_entrada(id,texto) VALUES(gen_random_uuid(),'Fictício') RETURNING id")).rows[0].id;
      const row=await create({box,natureza,cliente:null,servico:null});
      assert.equal(row.cliente_id,null);assert.equal(row.servico_id,null);
    }
  });
  test('chamadas repetidas retornam uma linha pela origem; outra Caixa não casa por título',async()=>{
    // PGlite serializa a conexão; o teste de índice abaixo cobre a restrição atômica no banco.
    const [a,b]=await Promise.all([create(),create()]);
    assert.equal(a.id,b.id);assert.equal(await count(),1);
    assert.notEqual((await create({box:OTHERBOX})).id,a.id);assert.equal(await count(),2);
  });
  test('constraint única protege origem mesmo fora da RPC',async()=>{
    await create();
    await assert.rejects(pg.query("INSERT INTO agenda(titulo,status,caixa_entrada_id) VALUES('Fictício','planejado',$1)",[BOX]),e=>e.code==='23505');
  });
  test('cancelado preservado e jamais reativado ou reaproveitado',async()=>{
    const a=await create();await pg.query("UPDATE agenda SET status='cancelado' WHERE id=$1",[a.id]);
    await assert.rejects(create(),/não será reativado/);assert.equal(await count(),1);
    assert.equal((await pg.query('SELECT status FROM agenda WHERE id=$1',[a.id])).rows[0].status,'cancelado');
  });
  test('novo trigger protege escrita direta de cliente sem serviço e rejeita IDs diferentes',async()=>{
    await assert.rejects(pg.query("INSERT INTO agenda(cliente_id,status) VALUES($1,'planejado')",[BAD]),/WhatsApp válido/);
    await assert.rejects(pg.query("INSERT INTO agenda(cliente_id,servico_id,status) VALUES($1,$2,'planejado')",[BAD,SERVICE]),/não corresponde/);
    const row=(await pg.query("INSERT INTO agenda(servico_id,status) VALUES($1,'planejado') RETURNING cliente_id",[SERVICE])).rows[0];
    assert.equal(row.cliente_id,CLIENT);
    await pg.query("INSERT INTO agenda(cliente_id,status) VALUES($1,'cancelado')",[BAD]);
    await pg.query("INSERT INTO agenda(tipo,status) VALUES('operacional','planejado')");
  });
  test('RPC é invoker e acesso negado a anônimo e autenticado não autorizado',async()=>{
    assert.equal((await pg.query("SELECT prosecdef FROM pg_proc WHERE proname='agenda_criar_da_caixa'")).rows[0].prosecdef,false);
    await pg.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[BAD]);
    await assert.rejects(create(),e=>e.code==='42501');
    await pg.exec('RESET ROLE; SET ROLE anon');await assert.rejects(create(),e=>e.code==='42501');
  });
  test('exclusão da Caixa preserva a Agenda, limpando somente FK de origem',async()=>{
    const a=await create();await pg.query('DELETE FROM caixa_entrada WHERE id=$1',[BOX]);
    const row=(await pg.query('SELECT * FROM agenda WHERE id=$1',[a.id])).rows[0];
    assert.equal(row.caixa_entrada_id,null);assert.equal(row.cliente_id,CLIENT);assert.equal(row.status,'planejado');
  });
  test('rollback preserva dados e origem; reaplicar restaura a proteção sem perder metadados',async()=>{
    const row=await create();
    await pg.exec('RESET ROLE');
    await pg.exec(await read('migracoes/rollback/agenda_caixa_identidade.sql'));
    assert.deepEqual((await pg.query('SELECT to_jsonb(a) AS row FROM agenda a WHERE id=$1',[row.id])).rows[0].row,row);
    await pg.exec(await read('migracoes/20260915153735_agenda_caixa_identidade.sql'));
    await pg.exec('SET ROLE authenticated');
    assert.equal((await create()).id,row.id);
    await assert.rejects(create({box:OTHERBOX,cliente:BAD,servico:null}),/WhatsApp válido/);
  });
});

test('formatação comercial nunca inventa nono dígito e mantém país explícito',()=>{
  assert.equal(helper.telefoneCadastroEstrito('61 9671-8270'),null);
  assert.equal(helper.telefoneCadastroEstrito('+55 61 9671-8270'),null);
  assert.equal(helper.telefoneCadastroEstrito('61 99999-9999'),'+5561999999999');
  assert.equal(helper.telefoneCadastroEstrito('+55 61 99999-9999'),'+5561999999999');
});

function mockDb({invalid=false,wrongReadback=false,emptyResolve=false,priorHour=null}={}){
  const calls=[];
  const db={calls,from(table){
    const q={select(){return q;},eq(){return q;},single:async()=>({data:table==='caixa_entrada'?(emptyResolve?null:{id:BOX,processado:true,status:'resolvido'}):table==='clientes'?{id:CLIENT,telefone:invalid?'+55 61 9671-8270':'+55 61 99999-9999'}:{id:SERVICE,cliente_id:CLIENT},error:null}),maybeSingle:async()=>table==='agenda'?{data:priorHour?{hora:priorHour}:null}:q.single(),update(){calls.push('resolve');return q;},then(resolve){resolve({error:null});}};return q;
  },async rpc(name,args){calls.push({name,args});return {data:{id:'agenda-ficticia',status:'planejado',caixa_entrada_id:BOX,cliente_id:wrongReadback?BAD:args.p_cliente_id,servico_id:args.p_servico_id}};}};
  return db;
}
const payload={natureza:'cliente',clienteId:CLIENT,servicoId:SERVICE,titulo:'Fictício',data:'2026-09-16',hora:'14:00',tipo:'remoto'};
test('helper interrompe telefone inválido e readback incorreto antes de resolver Caixa',async()=>{
  const invalid=mockDb({invalid:true});await assert.rejects(helper.criarDaCaixa(invalid,{id:BOX},payload),/WhatsApp inválido/);assert.equal(invalid.calls.length,0);
  await assert.rejects(helper.criarDaCaixa(mockDb({wrongReadback:true}),{id:BOX},payload),/não confirmou/);
  const blocked=mockDb();await assert.rejects(helper.criarDaCaixa(blocked,{id:BOX,texto:'BLOQUEIO DE CADASTRO'},{...payload,natureza:'avulso',clienteId:null,servicoId:null}),/Cadastro bloqueado/);assert.equal(blocked.calls.length,0);
});
test('helper distingue histórico bloqueado de confirmação posterior válida e exige identidade correspondente',async()=>{
  const item={id:BOX,texto:'BLOQUEIO DE CADASTRO',conversa:[{texto:'BLOQUEIO DE CADASTRO'},{meta:{tipo_operacional:'cadastro_validado',cliente_id:CLIENT,telefone_confirmado:'+5561999999999'}}]};
  assert.equal(helper.cadastroBloqueado(item),false);
  assert.equal((await helper.criarDaCaixa(mockDb(),item,payload)).cliente_id,CLIENT);
  await assert.rejects(helper.criarDaCaixa(mockDb(),item,{...payload,natureza:'avulso',clienteId:null,servicoId:null}),/confirmação de cadastro/);
  item.conversa.push({meta:{tipo_operacional:'cadastro_bloqueado'}});
  assert.equal(helper.cadastroBloqueado(item),true);
});

const index=await read('index.html'); const nova=await read('nova.html');
test('JavaScript da tela antiga continua válido',()=>{
  const scripts=[...index.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]);
  for(const source of scripts) new vm.Script(source);
});
test('callback real Lançar compromisso no index mantém inválido na Caixa e usa IDs válidos',async()=>{
  const start="btnLancarCompromisso.addEventListener('click', async ()=>{";
  const body=index.slice(index.indexOf(start)+start.length,index.indexOf("\n      });\n      acoes.appendChild(btnLancarCompromisso);"));
  for(const invalid of [true,false]){
    const db=mockDb({invalid});const choices=['Fictício','remoto'];
    const context=vm.createContext({window:{BahiaAgendaCaixa:helper},BahiaAgendaCaixa:helper,sb:db,item:{id:BOX},registro:{texto:'Fictício'},escolherVinculoAgendaCaixa:async()=>payload,askText:async()=>choices.shift(),exigirPrazo:async()=>payload.data,horariosParaTipo:()=>['14:00'],confirmarComDiaVisivel:async()=>payload.hora,cidadeChave:s=>s,toast:()=>{},carregarCaixaEntrada:()=>{},renderInicio:()=>{}});
    await vm.runInContext('(async()=>{'+body+'})()',context);
    assert.equal(db.calls.some(c=>c==='resolve'),!invalid);
    if(!invalid) assert.equal(db.calls[0].args.p_cliente_id,CLIENT);
  }
});
test('callback real finishAgenda da nova exige escolha explícita e valida vínculo antes de resolver',async()=>{
  const source=nova.slice(nova.indexOf('  async function finishAgenda(item) {'),nova.indexOf('  async function finishFinance(item) {'));
  for(const invalid of [true,false]){
    const db=mockDb({invalid});let resolved=false;
    const context=vm.createContext({window:{BahiaAgendaCaixa:helper},BahiaAgendaCaixa:helper,db,form:{service:'Fictício',due:payload.data,agendaType:'remoto',agendaNatureza:'cliente',agendaClienteId:CLIENT,agendaServicoId:SERVICE,city:'',time:'14:00'},demo:false,setBusy:()=>{},agendaVisivel:[],ehRemoto:()=>true,horaSugerida:()=>payload.hora,resolveInbox:async()=>{resolved=true;},loadAll:async()=>{},notify:()=>{}});
    vm.runInContext(source,context);await context.finishAgenda({id:BOX});
    assert.equal(resolved,!invalid);
  }
});
test('resolveInbox real rejeita zero linhas e finishAgenda informa que Agenda ficou salva',async()=>{
  const source=nova.slice(nova.indexOf('  async function resolveInbox(item, result) {'),nova.indexOf('  function updateForm(key, value)'));
  const finish=nova.slice(nova.indexOf('  async function finishAgenda(item) {'),nova.indexOf('  async function finishFinance(item) {'));
  const db=mockDb({emptyResolve:true});const notices=[];
  const context=vm.createContext({window:{BahiaAgendaCaixa:helper},BahiaAgendaCaixa:helper,db,form:{service:'Fictício',due:payload.data,agendaType:'remoto',agendaNatureza:'cliente',agendaClienteId:CLIENT,agendaServicoId:SERVICE,city:'',time:'14:00'},demo:false,mode:'diego',parseInbox:()=>({images:[]}),eventMessage:()=>[],setBusy:()=>{},agendaVisivel:[],ehRemoto:()=>true,horaSugerida:()=>payload.hora,loadAll:async()=>{},notify:message=>notices.push(message)});
  vm.runInContext(source+finish,context);
  await context.finishAgenda({id:BOX});
  assert.equal(db.calls[0].name,'agenda_criar_da_caixa');
  assert.match(notices[0],/Compromisso salvo; a Caixa continua pendente/);
  assert.match(notices[0],/não foi confirmada/);
});
test('index detecta readback vazio da Caixa após gravar e orienta retomada',async()=>{
  const start="btnLancarCompromisso.addEventListener('click', async ()=>{";
  const body=index.slice(index.indexOf(start)+start.length,index.indexOf("\n      });\n      acoes.appendChild(btnLancarCompromisso);"));
  const db=mockDb({emptyResolve:true});const choices=['Fictício','remoto'];const notices=[];
  const context=vm.createContext({window:{BahiaAgendaCaixa:helper},BahiaAgendaCaixa:helper,sb:db,item:{id:BOX},registro:{texto:'Fictício'},escolherVinculoAgendaCaixa:async()=>payload,askText:async()=>choices.shift(),exigirPrazo:async()=>payload.data,horariosParaTipo:()=>['14:00'],confirmarComDiaVisivel:async()=>payload.hora,cidadeChave:s=>s,toast:message=>notices.push(message),carregarCaixaEntrada:()=>{},renderInicio:()=>{}});
  await vm.runInContext('(async()=>{'+body+'})()',context);
  assert.match(notices[0],/Compromisso salvo/);assert.match(notices[0],/resolução da Caixa não foi confirmada/);
});
test('retomada de hora automática usa a hora gravada na mesma origem, sem gerar outra',async()=>{
  const db=mockDb({priorHour:'14:00:00'});
  await helper.criarDaCaixa(db,{id:BOX},{...payload,hora:'15:00',horaAutomatica:true});
  assert.equal(db.calls[0].args.p_hora,'14:00:00');
});

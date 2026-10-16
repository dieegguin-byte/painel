// Gatilhos de migracoes/20261016160000_card_pagamento_ligado.sql num Postgres em memória (PGlite).
// Rodar: node --test tests/card-pagamento-ligado.test.mjs
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const MIG = path.join(path.dirname(fileURLToPath(import.meta.url)), '../migracoes/20261016160000_card_pagamento_ligado.sql');
test('card de pagar ligado ao Dinheiro e proposta aprovada fecham/reabrem nos dois sentidos', async () => {
const db = new PGlite();
const q = async (s) => (await db.query(s)).rows;
const one = async (s) => (await q(s))[0];
await db.exec(`
create schema private;
create table public.agenda (id uuid primary key default gen_random_uuid(), titulo text, data date, hora time, status text, servico_id uuid, cliente_id uuid);
create table public.financeiro (id uuid primary key default gen_random_uuid(), tipo text, status text, valor numeric, data date, agenda_id uuid, categoria text, descricao text);
create table public.propostas (id uuid primary key default gen_random_uuid(), servico_id uuid, cliente_id uuid, status text, enviado_em timestamptz);
create function public.trava() returns trigger language plpgsql as $$ begin
 if new.status='feito' and new.data > (now() at time zone 'America/Sao_Paulo')::date then raise exception 'futuro'; end if; return new; end $$;
create trigger trava before insert or update on agenda for each row execute function trava();
`);
await db.exec(fs.readFileSync(MIG, 'utf8'));
const hoje = (await one(`select (now() at time zone 'America/Sao_Paulo')::date::text d`)).d;
let ok = 0, bad = 0; const eq = (n, a, b) => { if (JSON.stringify(a) === JSON.stringify(b)) ok++; else { bad++; console.log('FAIL', n, JSON.stringify(a), JSON.stringify(b)); } };
const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const card = async (n, titulo, data, extra = {}) => db.exec(`insert into agenda(id,titulo,data,hora,status,financeiro_id,servico_id,cliente_id) values ('${U(n)}','${titulo}','${data}','08:00','planejado',${extra.fin ? `'${U(extra.fin)}'` : 'null'},${extra.svc ? `'${U(extra.svc)}'` : 'null'},${extra.cli ? `'${U(extra.cli)}'` : 'null'})`);
const fin = async (n, status, valor, data, extra = {}) => db.exec(`insert into financeiro(id,tipo,status,valor,data,agenda_id,categoria) values ('${U(n)}','${extra.tipo || 'saida'}','${status}',${valor},'${data}',${extra.ag ? `'${U(extra.ag)}'` : 'null'},'${extra.cat || 'Outro'}')`);
const ag = (n) => one(`select status, data::text, fechado_por is not null as marca from agenda where id='${U(n)}'`);
const fi = (n) => one(`select status, data::text, baixa_pela_agenda is not null as marca from financeiro where id='${U(n)}'`);

// A) Paguei no Dinheiro fecha o card ligado (futuro → hoje); desfazer devolve
await fin(101, 'a_pagar', 100, '2026-10-20'); await card(1, 'Pagar Pix — X', '2030-01-01', { fin: 101 });
await db.exec(`update financeiro set status='pago', data='${hoje}' where id='${U(101)}'`);
eq('A paguei fecha', await ag(1), { status: 'feito', data: hoje, marca: true });
await db.exec(`update financeiro set status='a_pagar' where id='${U(101)}'`);
eq('A desfaz reabre', await ag(1), { status: 'planejado', data: '2030-01-01', marca: false });
// B) Feito no card paga; desfazer card devolve status e data
await fin(102, 'a_pagar', 50, '2026-10-20'); await card(2, 'Pagar Pix — Y', hoje, { fin: 102 });
await db.exec(`update agenda set status='feito' where id='${U(2)}'`);
eq('B feito paga', await fi(102), { status: 'pago', data: hoje, marca: true });
await db.exec(`update agenda set status='planejado' where id='${U(2)}'`);
eq('B desfaz', await fi(102), { status: 'a_pagar', data: '2026-10-20', marca: false });
// C) marca velha não desfaz pagamento real: card pagou, Diego desfez em Dinheiro, pagou de novo em Dinheiro, depois desfaz card
await db.exec(`update agenda set status='feito' where id='${U(2)}'`);            // card paga (marca)
await db.exec(`update financeiro set status='a_pagar' where id='${U(102)}'`);     // dinheiro desfaz -> card reabre? (card foi fechado pelo próprio card, não pelo financeiro)
eq('C marca limpa', (await fi(102)).marca, false);
eq('C dinheiro desfaz reabre card que pagou', (await ag(2)).status, 'planejado');
await db.exec(`update agenda set status='feito' where id='${U(2)}'`);
await db.exec(`update financeiro set status='a_pagar', baixa_pela_agenda=null where id='${U(102)}'`).catch(()=>{});
await db.exec(`update financeiro set status='pago' where id='${U(102)}'`);
await db.exec(`update agenda set status='planejado' where id='${U(2)}'`);
eq('C pagamento real fica', (await fi(102)).status, 'pago');
// D) receber
await fin(103, 'a_receber', 300, '2026-10-20', { tipo: 'entrada' }); await card(3, 'Receber — Iris', hoje, { fin: 103 });
await db.exec(`update agenda set status='feito' where id='${U(3)}'`);
eq('D recebido', (await fi(103)).status, 'pago');
// E) valor 0 não paga
await fin(104, 'a_pagar', 0, '2026-10-15'); await card(4, 'Pagar — Matheus', hoje, { fin: 104 });
await db.exec(`update agenda set status='feito' where id='${U(4)}'`);
eq('E zero fica', (await fi(104)).status, 'a_pagar');
// F) material pendurado numa entrega (financeiro.agenda_id) — nada muda nos dois sentidos
await card(5, 'Entregar sofá — Carla', hoje); await fin(105, 'a_pagar', 380, '2026-10-10', { ag: 5, cat: 'Material' });
await db.exec(`update agenda set status='feito' where id='${U(5)}'`);
eq('F material fica a comprar', (await fi(105)).status, 'a_pagar');
await card(6, 'Entregar cadeiras — Ana', '2030-01-01'); await fin(106, 'a_pagar', 120, '2026-10-10', { ag: 6, cat: 'Material' });
await db.exec(`update financeiro set status='pago' where id='${U(106)}'`);
eq('F comprar não fecha entrega', (await ag(6)).status, 'planejado');
// G) cancelar não paga
await fin(107, 'a_pagar', 10, hoje); await card(7, 'Pagar', hoje, { fin: 107 });
await db.exec(`update agenda set status='cancelado' where id='${U(7)}'`);
eq('G cancelar', (await fi(107)).status, 'a_pagar');
// H) propostas
await card(8, 'Aprovar a proposta — João — cadeira', hoje, { svc: 900 });
await card(9, 'Entregar — João', hoje, { svc: 900 });
await card(10, 'Mandar orçamento — Edna', '2030-01-01', { svc: 901 });
await card(11, 'Mandar orçamento — Ana sofá', hoje, { cli: 950 }); await card(12, 'Mandar orçamento — Ana cadeira', hoje, { cli: 950 });
await card(13, 'Mandar orçamento — Bia', hoje, { cli: 951 });
await db.exec(`insert into propostas(id,servico_id,cliente_id,status) values ('${U(801)}','${U(900)}',null,'aguardando'),('${U(802)}','${U(901)}',null,'aguardando'),('${U(803)}',null,'${U(950)}','aguardando'),('${U(804)}',null,'${U(951)}','aguardando')`);
await db.exec(`update propostas set status='aprovada' where id='${U(801)}'`);
eq('H fecha card', { ...(await ag(8)), ag: (await one(`select agenda_id::text a from propostas where id='${U(801)}'`)).a }, { status: 'feito', data: hoje, marca: true, ag: U(8) });
eq('H entrega intacta', (await ag(9)).status, 'planejado');
await db.exec(`update propostas set status='aguardando' where id='${U(801)}'`);
eq('H desfaz reabre', (await ag(8)).status, 'planejado');
await db.exec(`update propostas set status='aprovada' where id='${U(802)}'`);
eq('H futuro vira hoje', await ag(10), { status: 'feito', data: hoje, marca: true });
await db.exec(`update propostas set status='aguardando' where id='${U(802)}'`);
eq('H volta data', await ag(10), { status: 'planejado', data: '2030-01-01', marca: false });
await db.exec(`update propostas set status='recado' where id='${U(802)}'`);
eq('H recado não fecha', (await ag(10)).status, 'planejado');
await db.exec(`update propostas set status='aprovada' where id='${U(803)}'`);
eq('H sem serviço e 2 cards: não chuta', [(await ag(11)).status, (await ag(12)).status], ['planejado', 'planejado']);
await db.exec(`update propostas set status='aprovada' where id='${U(804)}'`);
eq('H sem serviço e 1 card: fecha', (await ag(13)).status, 'feito');
assert.equal(bad, 0, `${bad} caso(s) falharam`);
});

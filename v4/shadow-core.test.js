
'use strict';
const assert=require('node:assert/strict');
const c=require('./shadow-core');
assert.deepEqual(c.agendaState({state:'confirmado'}).value,'confirmado');
assert.equal(c.agendaState({}).certainty,'insufficient');
assert.equal(c.serviceStage({stage:'produção'}).value,'producao');
assert.equal(c.serviceStage({stage:'qualquer'}).certainty,'insufficient');
assert.equal(c.isReceivedRevenue({direction:'entrada',scope:'empresa',amount:100,status:'recebido'}).value,true);
assert.equal(c.isReceivedRevenue({direction:'entrada',scope:'empresa',amount:100,status:'previsto'}).value,false);
assert.equal(c.isReceivedRevenue({direction:'entrada',scope:'empresa',amount:100}).certainty,'insufficient');
assert.equal(c.marketingAttribution({utm_source:'google'}).certainty,'known');
assert.equal(c.marketingAttribution({}).certainty,'insufficient');
assert.equal(c.requiredHumanDecision({external_write:true,approved:false}).value,true);
assert.deepEqual(c.duplicateIds([{id:'1'},{id:'2'},{id:'1'}]),['1']);
assert.equal(c.compare('agenda','a1',c.agendaState({state:'confirmado'}),'confirmado').result,'igual');
assert.equal(c.runChecks({agenda:[{id:'a1'}],services:[],finance:[],marketing:[],clients:[]}).ok,false);
console.log('shadow-core tests: ok');

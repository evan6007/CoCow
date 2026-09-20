import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceTier} from './service-tier.mjs';
import {catalog} from './model-routing.mjs';
import {PeerBridge} from './peer-bridge.mjs';
const models=catalog([{model:'gpt-6-astra',serviceTiers:[{id:'priority',name:'Fast'}]}]);
test('catalog preserves advertised Fast tier and default is opt-in',()=>{assert.equal(serviceTier(models,'gpt-6-astra'),'default');assert.equal(serviceTier(models,'gpt-6-astra','priority'),'priority');});
test('unsupported and invalid speed requests fail explicitly',()=>{assert.throws(()=>serviceTier([],'missing','priority'));assert.throws(()=>serviceTier(models,'gpt-6-astra','anything'));});
test('paired transport preserves speed selection',async()=>{let sent;const fake={request:async(path,body)=>{sent={path,body};}};await PeerBridge.prototype.rpc.call(fake,'turn/start',{threadId:'t',model:'gpt-6-astra',input:[{type:'text',text:'hi'}],serviceTierForTurn:'priority'});assert.equal(sent.body.serviceTier,'priority');assert.equal(sent.path,'/peer/turn');});

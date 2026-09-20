import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AccountBudgets} from './account-budgets.mjs';
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'cocow-budget-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 let now=1800000000000;const reset=now/1000+604800;
 const b=new AccountBudgets(dir,'owner@example.com',{now:()=>now});
 b.configure('owner@example.com',{login:'member@example.com',enabled:true,period:'week',mode:'percent',percentLimit:25});
 const observe=(offset=0,used=5)=>{now+=1000;b.observeStatus({capturedAt:new Date(now).toISOString(),authMode:'chatgpt',billing:{evidence:{officialRouteVerified:true,matchesExpectedAccount:true,noExtraCodexCredits:true}},canStartChat:true,windows:[{slot:'primary',windowDurationMins:10080,usedPercent:used,resetsAt:reset+offset}]});};
 observe();const id=b.reserve('member@example.com',{});b.dispatch(id);
 return {b,id,observe};
}
test('one-second reset jitter retains usage and does not block the next request',t=>{
 const {b,id,observe}=fixture(t),key=b.sharedView().key;
 observe(1,6);observe(0,7);b.measure(id,{last:{totalTokens:15867}});b.finish(id);
 assert.equal(b.sharedView().key,key);assert.equal(b.view('member@example.com').percentUsed,2);
 assert.equal(b.view('member@example.com').percentUnknown,0);assert.equal(b.data.entries[0].status,'completed');assert.doesNotThrow(()=>b.check('member@example.com'));
});
test('real rollover remains uncertain',t=>{const {b,id,observe}=fixture(t);const key=b.sharedView().key;observe(604800,0);b.finish(id);assert.notEqual(b.sharedView().key,key);assert.equal(b.view('member@example.com').percentUnknown,1);});
test('downward correction retains charged usage without locking account',t=>{const {b,id,observe}=fixture(t);observe(0,7);observe(1,4);b.finish(id,{uncertain:true});assert.equal(b.view('member@example.com').percentUnknown,0);assert.equal(b.view('member@example.com').percentUsed,2);assert.doesNotThrow(()=>b.check('member@example.com'));});
test('timestamp drift cannot accumulate beyond the original tolerance',t=>{const {b,id,observe}=fixture(t);const key=b.sharedView().key;observe(4);assert.equal(b.sharedView().key,key);observe(8);b.finish(id);assert.notEqual(b.sharedView().key,key);assert.equal(b.view('member@example.com').percentUnknown,1);});
test('missing final sample remains blocked and acknowledgment preserves recorded charges',t=>{const {b,id}=fixture(t);b.finish(id,{uncertain:true});assert.equal(b.view('member@example.com').percentUnknown,1);assert.throws(()=>b.check('member@example.com'));b.acknowledge('owner@example.com','member@example.com');assert.equal(b.view('member@example.com').percentUnknown,0);assert.ok(b.data.audit.some(x=>x.action==='acknowledge-reported-usage'));});

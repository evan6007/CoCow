import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AccountBudgets} from './account-budgets.mjs';
const source=readFileSync(new URL('./server.mjs',import.meta.url),'utf8');
const check=source.match(/verifyAllowance\(before\);(budgets\.check\([^;]+\);)/)[1];
const preflight=new Function('budgets','access',check);
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'cocow-parallel-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const b=new AccountBudgets(dir,'owner@example.com');b.configure(b.owner,{login:'member@example.com',enabled:true,period:'week',mode:'tokens',tokenLimit:1000,requestLimit:3});return b;}
test('actual chat preflight allows another conversation for a running account',t=>{const b=fixture(t);b.dispatch(b.reserve('member@example.com',{}));assert.doesNotThrow(()=>preflight(b,{login:'member@example.com'}));const second=b.reserve('member@example.com',{});b.dispatch(second);assert.equal(b.view('member@example.com').pending,2);});
test('parallel preflight still enforces request limits and disabled accounts',t=>{const b=fixture(t);for(let i=0;i<3;i++)b.dispatch(b.reserve('member@example.com',{}));assert.throws(()=>preflight(b,{login:'member@example.com'}),/次數/);assert.throws(()=>preflight(b,{login:'unknown@example.com'}),/分配|暫停/);});

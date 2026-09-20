import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ExecutionService} from './execution.mjs';
test('explicit automatic approval executes current and next workspace operation without another prompt',async t=>{const dir=mkdtempSync(join(tmpdir(),'approval-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const e=new ExecutionService(dir);e.config.enabled=true;e.config.mode='ask';let calls=0;e.runCommand=async()=>({calls:++calls});const first=e.callFromAgent('run_command',{command:'echo test'});const item=e.approvals.list()[0];assert.ok(item);await e.call('approval',{id:item.id,allow:true,auto:true});assert.equal((await first).calls,1);assert.equal(e.config.mode,'auto');assert.equal((await e.callFromAgent('run_command',{command:'echo next'})).calls,2);assert.equal(e.approvals.list().length,0);e.config.enabled=false;await assert.rejects(e.callFromAgent('run_command',{}));});
test('automatic approval cannot grant desktop or MCP authority',async t=>{const dir=mkdtempSync(join(tmpdir(),'approval-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const e=new ExecutionService(dir);e.config.enabled=true;e.config.mode='ask';const pending=e.approvals.request('desktop',{}),item=e.approvals.list()[0];await assert.rejects(e.call('approval',{id:item.id,allow:true,auto:true}));assert.equal(e.config.mode,'ask');e.approvals.revoke();assert.equal(await pending,false);});

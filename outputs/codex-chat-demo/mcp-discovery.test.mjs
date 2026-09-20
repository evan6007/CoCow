import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ExecutionService} from './execution.mjs';
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'cocow-mcp-discovery-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const e=new ExecutionService(dir);e.mcp.options.discover=async()=>({});e.config.enabled=true;e.mcp.configure({fixture:{enabled:true,command:'never-launch-this-command',args:[],env:{TEST_SECRET:'secret-value'}}});return e;}
for(const mode of ['auto','ask'])test(`${mode} lists sanitized servers without launch or approval`,async t=>{const e=fixture(t);e.config.mode=mode;e.approvals.request=()=>{throw Error('unexpected approval');};e.mcp.client=()=>{throw Error('unexpected launch');};assert.deepEqual(await e.callFromAgent('mcp_connector',{action:'servers'}),{servers:[{name:'fixture',enabled:true,connected:false}]});});
test('restricted modes still block MCP execution and revocation blocks discovery',async t=>{const e=fixture(t);e.config.mode='ask';e.approvals.request=async()=>false;for(const action of ['tools','call'])await assert.rejects(e.callFromAgent('mcp_connector',{action,server:'fixture',tool:'test'}),/未獲授權/);await assert.rejects(e.callFromAgent('mcp_connector',{action:'servers'},()=>false),/回合已結束/);e.config.enabled=false;await assert.rejects(e.callFromAgent('mcp_connector',{action:'servers'}),/尚未啟用/);});

for(const mode of ['auto','ask'])test(`${mode} executes approved MCP tools without full access`,async t=>{const e=fixture(t);e.config.mode=mode;let approvals=0,calls=0;e.approvals.request=async()=>{approvals++;return true;};e.mcp.call=async a=>{calls++;return {action:a.action,value:'secret-value'};};for(const action of ['tools','call'])assert.equal((await e.callFromAgent('mcp_connector',{action,server:'fixture',tool:'test'})).value,'[REDACTED]');assert.equal(approvals,mode==='ask'?2:0);assert.equal(calls,2);assert.equal(e.config.mode,mode);});
test('stopped turns cannot execute after delayed MCP approval',async t=>{const e=fixture(t);e.config.mode='ask';let active=true;e.approvals.request=async()=>{active=false;return true;};e.mcp.call=async()=>{throw Error('should not execute');};await assert.rejects(e.callFromAgent('mcp_connector',{action:'tools',server:'fixture'},()=>active),/回合或授權/);});

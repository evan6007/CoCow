import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('restart token recovery retries only reads and preserves write failures',async()=>{
 const source=readFileSync(new URL('./feedback-ui.js',import.meta.url),'utf8'),code=source.slice(source.indexOf('async function api('),source.indexOf('function previews('));const calls=[];const headers={'x-demo-token':'old'};
 const ctx=vm.createContext({headers,AbortSignal,DOMParser:class{parseFromString(){return {querySelector:()=>({content:'new'})};}},fetch:async(url,options)=>{calls.push({url,method:options.method});if(url==='/feedback')return {ok:true,text:async()=>'<meta>'};return headers['x-demo-token']==='new'&&options.method==='GET'?{ok:true,status:200,json:async()=>({reports:[1]})}:{ok:false,status:403,json:async()=>({error:'expired'})};}});
 vm.runInContext(code,ctx);assert.deepEqual(await ctx.api(),{reports:[1]});assert.equal(calls.length,3);assert.equal(headers['x-demo-token'],'new');await assert.rejects(ctx.api('PATCH',{id:'x'}),/expired/);assert.equal(calls.length,4);
});
test('background refresh detects changes, preserves interaction and retries failures',async()=>{
 const nodes=new Map(),events={},intervals=[];let calls=0,renders=0,fail=false;
 let result={apiVersion:2,reports:[],admin:false,owner:''};
 const node=id=>{if(!nodes.has(id))nodes.set(id,{open:false,value:'',content:'test',addEventListener(){},classList:{add(){},remove(){}}});return nodes.get(id);};
 const document={hidden:false,activeElement:null,getElementById:node,querySelector:()=>node('meta'),addEventListener:(n,f)=>events[n]=f};
 const ctx=vm.createContext({createFeedbackThread:()=>({sync(){}}),AbortSignal,document,window:{addEventListener:(n,f)=>events[n]=f},setInterval:(f,ms)=>intervals.push({f,ms}),fetch:async()=>{calls++;if(fail)throw Error('offline');return {ok:true,json:async()=>structuredClone(result)};},countRender:()=>renders++});
 const source=readFileSync(new URL('./feedback-ui.js',import.meta.url),'utf8');vm.runInContext(source.slice(source.indexOf('const $='),source.indexOf("$('search').oninput=render")),ctx);vm.runInContext('render=()=>countRender()',ctx);
 assert.equal(intervals[0].ms,5000);await intervals[0].f();assert.equal(calls,1);assert.equal(renders,0);
 result.reports=[{id:'new',text:'new report'}];await intervals[0].f();assert.equal(renders,1);await intervals[0].f();assert.equal(renders,1);
 node('composer').open=true;await intervals[0].f();assert.equal(calls,3);node('composer').open=false;
 document.hidden=true;await intervals[0].f();assert.equal(calls,3);document.hidden=false;
 fail=true;await intervals[0].f();assert.match(node('status').textContent,/中斷/);fail=false;await events.online();assert.match(node('status').textContent,/恢復/);
});

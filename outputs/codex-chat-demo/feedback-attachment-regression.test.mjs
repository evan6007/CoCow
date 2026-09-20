import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./server.mjs',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function chatView(c)'),source.indexOf('function parentForNewChat'));
function view(message,{extracted=[],refs=[],missing=[]}={}){
 const ctx=vm.createContext({findTurn:()=>null,attachmentStore:{extract:()=>[...extracted],refs:new Set(refs)},uploads:{record:id=>{if(missing.includes(id))throw Error('missing');return {id,name:'image.png',mime:'image/png'};},public:r=>r}});
 vm.runInContext(code,ctx);return ctx.chatView({id:'fixture',user:'我',messages:[message]}).messages[0];
}
test('feedback multi-image: mixed stored and uploaded same-name attachments survive',()=>{
 const m=view({attachments:[{id:'b',name:'image.png'}],uploadIds:['a','b','c']},{extracted:[{id:'a',name:'image.png'}],refs:['b']});
 assert.deepEqual(Array.from(m.attachments,a=>a.id),['a','b','c']);assert.equal(Object.hasOwn(m,'uploadIds'),false);
});
test('feedback multi-image: missing upload does not discard later valid images',()=>{
 const m=view({uploadIds:['a','missing','c']},{missing:['missing']});assert.deepEqual(Array.from(m.attachments,a=>a.id),['a','c']);
});
test('feedback multi-image: readback does not mutate persisted attachment identifiers',()=>{
 const message={uploadIds:['a','b','c','a']};const before=JSON.stringify(message);view(message);assert.equal(JSON.stringify(message),before);
});
const ui=readFileSync(new URL('./task-workbench.js',import.meta.url),'utf8');
function menu(task,admin){
 const nodes=[];const el=(tag,cls='',text='')=>{const n={tag,text,children:[],append(...v){this.children.push(...v);},setAttribute(){},focus(){},style:{},offsetHeight:200,remove(){}};nodes.push(n);return n;};
 const ctx=vm.createContext({el,state:{access:{isAdmin:admin},projects:{data:[]}},document:{body:{append(){}}},innerWidth:800,innerHeight:600,closeTaskMenu(){},archiveTask(){},removeTask(){},moveTask(){}});
 vm.runInContext(ui.slice(ui.indexOf(' function showTaskMenu('),ui.indexOf(' function fact(')),ctx);ctx.showTaskMenu(task,{getBoundingClientRect:()=>({right:100,top:100})});return nodes;
}
test('feedback chat menu: owner sees delete, archive and project move',()=>{
 const nodes=menu({chatId:'fixture',title:'Test',state:'completed'},true);assert.ok(nodes.some(n=>n.tag==='button'&&n.text==='從 CoCow 刪除'));assert.ok(nodes.some(n=>n.tag==='button'&&n.text==='封存對話'));assert.ok(nodes.some(n=>n.tag==='select'&&!n.disabled));
});
test('feedback chat menu: running task disables mutations',()=>{
 const nodes=menu({chatId:'fixture',title:'Test',state:'running'},true);assert.ok(nodes.filter(n=>n.tag==='button'||n.tag==='select').every(n=>n.disabled));
});
test('feedback chat menu: native history is archived, not destructively deleted',()=>{
 const nodes=menu({nativeId:'fixture',title:'Test',state:'completed'},true);assert.equal(nodes.some(n=>n.text==='從 CoCow 刪除'),false);assert.ok(nodes.some(n=>n.text==='封存對話'));
});
test('feedback chat menu: non-admin deletion remains unavailable',()=>{
 assert.equal(menu({chatId:'fixture',title:'Test',state:'completed'},false).some(n=>n.text==='從 CoCow 刪除'),false);
});

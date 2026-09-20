import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {version,buildNumber} from './release.js';
test('single update action detects releases, protects active work and reloads stale UI',async()=>{
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{classList:{toggle(k,v){this[k]=v;}},append(){},replaceChildren(){},before(){},setAttribute(){},removeAttribute(){}});return nodes.get(id);};let available=false,active=false,reloads=0,saved=0,liveBuild=buildNumber;
 const ctx=vm.createContext({version,document:{hidden:false,createElement:()=>node('generated'+nodes.size),querySelector:()=>active?{}:null},window:{addEventListener(){}},setInterval(){},fetch:async()=>({ok:true,json:async()=>({build:liveBuild,version:'0.60.9'})}),location:{reload(){reloads++;}},AbortSignal});
 vm.runInContext(readFileSync(new URL('./update-controls.js',import.meta.url),'utf8').replace("import {version} from './release.js';",'').replace('export function','function'),ctx);
 const controls=ctx.createUpdateControls({$:node,buildNumber,saveDraft:()=>saved++,api:async()=>({available,latestVersion:'0.60.9',latest:buildNumber+1,notes:['test changes']})});await new Promise(r=>setImmediate(r));assert.match(version,/^\d+\.\d+\.\d+$/);assert.equal(node('settings-version').textContent,'v'+version);await controls.update();assert.match(node('update-status').textContent,/最新版本/);
 available=true;await controls.check();assert.equal(node('check-update').textContent,'查看 v0.60.9 更新內容');assert.equal(node('version-open').classList['has-update'],true);assert.equal(node('version-open').textContent,'v'+version);
 active=true;let opened=0;node('settings-open').click=()=>opened++;node('version-open').onclick();assert.equal(opened,1);await controls.update();assert.equal(saved,0);active=false;liveBuild++;await controls.update();assert.equal(saved,0);await controls.update(true);assert.equal(saved,1);assert.equal(reloads,1);
});

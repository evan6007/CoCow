import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FeedbackStore} from './feedback.mjs';
test('classification persists without changing report content, owner or workflow',t=>{const dir=mkdtempSync(join(tmpdir(),'cocow-feedback-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const store=new FeedbackStore(dir);const original=store.create('reporter',{text:'原始回報',images:[],visibility:'private'});store.progress(original.id,'admin',{phase:'investigating',text:'Investigating report'});store.classify(original.id,{kind:'bug',category:'自訂新分類',reason:'診斷原因'});const r=new FeedbackStore(dir).list('reporter')[0];assert.equal(r.text,original.text);assert.equal(r.owner,original.owner);assert.equal(r.status,'in-progress');assert.equal(r.classification.category,'自訂新分類');assert.equal(store.list('another').length,0);store.move(r.id,'done');assert.equal(store.list('reporter')[0].classification.kind,'bug');for(const c of [{kind:'invalid',category:'a',reason:''},{kind:'bug',category:'',reason:''},{kind:'bug',category:'a'.repeat(61),reason:''}])assert.throws(()=>store.classify(r.id,c));});

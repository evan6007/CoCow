import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('background conversation refresh preserves manually selected library even while response is pending',async()=>{
 const code=readFileSync(new URL('./client.js',import.meta.url),'utf8');const start=code.indexOf('async function openOfficial('),end=code.indexOf('\nfunction ',start);
 const state={official:{id:'source',messages:[]},officialSeq:0,chats:[],turns:new Map(),runningChats:new Set(),libraryMode:'codex'};let release;const response=new Promise(r=>release=r);const node={scrollTop:0,scrollHeight:0};
 const ctx=vm.createContext({state,URLSearchParams,api:()=>response,$:()=>node,officialCache:new Map(),scrollFollow:{capture:()=>({}),restore(){},refresh(){}},pref:{set(){}},renderOfficial(){},updateControls(){},toast(){},console});
 vm.runInContext(code.slice(start,end),ctx);const pending=vm.runInContext("openOfficial('source',{refresh:true})",ctx);state.libraryMode='web';release({id:'source',messages:[],liveWorking:false});await pending;assert.equal(state.libraryMode,'web');assert.equal(state.official.id,'source');
});

test('opening original shared history resolves to its latest continuation without changing library',async()=>{
 const code=readFileSync(new URL('./client.js',import.meta.url),'utf8');const start=code.indexOf('async function openOfficial('),end=code.indexOf('\nfunction ',start);
 const state={official:null,officialRows:[],officialSeq:0,chats:[],turns:new Map(),runningChats:new Set(),libraryMode:'codex'};const node={scrollTop:0,scrollHeight:0};let selected;
 const ctx=vm.createContext({state,URLSearchParams,api:async()=>({id:'source',linkedChatId:'continued',continuationMode:'shared-history',messages:[{text:'old'}]}),$:()=>node,officialCache:new Map(),scrollFollow:{capture:()=>({}),latest(){},restore(){},refresh(){}},pref:{set(){}},saveDraft(){},loadDraft(){},renderOfficial(){},closeSidebar(){},updateControls(){},toast(){},refreshChats:async()=>{state.chats=[{id:'continued',messages:[{text:'new reply'}]}];},selectChat:async(id,options)=>{selected={id,options};state.chatId=id;state.official=null;state.officialSeq++;state.officialLoading=false;},console});
 vm.runInContext(code.slice(start,end),ctx);await vm.runInContext("openOfficial('source')",ctx);assert.equal(selected.id,'continued');assert.equal(selected.options.preserveLibrary,true);assert.equal(state.libraryMode,'codex');assert.equal(state.chatId,'continued');assert.equal(state.officialLoading,false);
});

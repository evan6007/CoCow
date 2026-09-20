import {randomUUID} from 'node:crypto';
export class ExecutionApprovals {
 constructor(){this.pending=new Map();}
 list(){return [...this.pending.values()].map(({resolve,timer,...p})=>p);}
 request(tool,args){if(this.pending.size>=5)throw new Error('待核准操作已達上限。');return new Promise(resolve=>{const id=randomUUID(),timer=setTimeout(()=>this.decide(id,false),120000);timer.unref();this.pending.set(id,{id,tool,summary:tool==='run_command'?String(args.command).slice(0,3000):String(args.path||args.file||tool),resolve,timer});});}
 decide(id,allow){const p=this.pending.get(id);if(!p)throw new Error('核准已過期。');clearTimeout(p.timer);this.pending.delete(id);p.resolve(allow===true);}
 revoke(){for(const id of [...this.pending.keys()])this.decide(id,false);}
}

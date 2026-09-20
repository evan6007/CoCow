import {readFileSync} from 'node:fs';
for (const file of ['server.mjs','client.js','index.html','README.md','chat-delete.test.mjs']) {
  const s=readFileSync(file,'utf8');
  console.log(`\n=== ${file} ===`);
  const re=/(?:deleted|delete|刪除|刪掉|soft|tombstone|restore)/ig; let m,n=0;
  while ((m=re.exec(s)) && n<40) { const a=Math.max(0,m.index-220), b=Math.min(s.length,m.index+420); console.log(`-- offset ${m.index} --\n${s.slice(a,b).replace(/\r?\n/g,'\\n')}`); n++; }
  if (!n) console.log('NO_MATCH');
}

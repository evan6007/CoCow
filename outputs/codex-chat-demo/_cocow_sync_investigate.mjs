import {readFileSync} from 'node:fs';
for (const file of ['server.mjs','client.js','index.html','projects.mjs']) {
  const text=readFileSync(file,'utf8');
  console.log(`\n===== ${file} =====`);
  const terms=['function chatView','parentForNewChat','/api/chat','codexThreadId','sourceCodexThreadId','/api/chats/sync','refresh-desktop','thread/start','thread/resume','continuationMode','desktopNotification'];
  for (const term of terms) {
    let at=0, n=0;
    while ((at=text.indexOf(term,at))>=0 && n<4) {
      const start=Math.max(0,at-220), end=Math.min(text.length,at+620);
      console.log(`--- ${term} @ ${at} ---\n${text.slice(start,end).replace(/\r/g,'')}`);
      at+=term.length; n++;
    }
  }
}

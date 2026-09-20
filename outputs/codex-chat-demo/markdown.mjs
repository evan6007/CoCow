import katex from './katex.mjs';
const escape = text => String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function inline(text) {
  const tokens=[];
  const keep = html => { const id=tokens.push(html)-1;return `\u0000${id}\u0000`; };
  let value=String(text).replace(/\u0000/g,'').replace(/`([^`\n]+)`/g,(_,code)=>keep(`<code>${escape(code)}</code>`));
  value=value.replace(/!\[([^\]\n]*)\]\((?:<([^>\n]+)>|(\/?[A-Za-z]:[\/\\][^\n)]+))\)/g,(all,label,a,b)=>{const path=(a||b).replace(/^\/([A-Za-z]:)/,'$1');if(!/^[A-Za-z]:[\/\\]/.test(path))return all;return keep(`<span class="inline-image-card" data-image-path="${escape(path)}"><button type="button" class="inline-image-preview">載入圖片…</button><span class="inline-image-actions"><span>${escape(label||'圖片')}</span><button type="button" data-local-path="${escape(path)}">在檔案總管顯示</button><a class="inline-image-download" hidden>下載</a></span></span>`);});
  value=value.replace(/\\\((.+?)\\\)|\$([^$\n]+)\$/g,(_,a,b)=>keep(katex.renderToString(a||b,{output:'mathml',throwOnError:false,trust:false,strict:'ignore',maxExpand:500})));
  value=escape(value).replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|[a-zA-Z]:[\/\\][^\n)]+|codex:\/\/threads\/[a-zA-Z0-9-]+)\)/g,(_,label,url)=>keep(/^[a-zA-Z]:/.test(url)?`<button type="button" class="local-file-link" data-local-path="${url}" title="在檔案所在電腦顯示：${url}">▧ ${label}</button>`:`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`));
  value=value.replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*\n]+)\*/g,'<em>$1</em>');
  return value.replace(/\u0000(\d+)\u0000/g,(_,id)=>tokens[Number(id)] || '');
}
export function markdown(text) {
  const lines=String(text).replace(/\r/g,'').split('\n');const out=[];let paragraph=[],list=[],listType=null,code=null,language='';
  const flushP=()=>{if(paragraph.length){out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);paragraph=[];}};
  const flushL=()=>{if(list.length){out.push(`<${listType}>${list.map(t=>`<li>${inline(t)}</li>`).join('')}</${listType}>`);list=[];listType=null;}};
  const flushCode=()=>{out.push(`<div class="code-block"><div class="code-header"><span>${escape(language||'text')}</span><button type="button" class="copy-code">複製程式碼</button></div><pre><code>${escape(code.join('\n'))}</code></pre></div>`);code=null;};
  const cells=line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split(/(?<!\\)\|/).map(s=>s.trim().replace(/\\\|/g,'|'));
  for(let i=0;i<lines.length;i++){const line=lines[i];
    if(/^\s*```/.test(line)){if(code)flushCode();else{flushP();flushL();language=line.trim().slice(3).trim();code=[];}continue;}
    if(code){code.push(line);continue;}
    if(/^\s*(\$\$|\\\[)/.test(line)){
      flushP();flushL();const closing=line.trim().startsWith('$$')?'$$':'\\]';let formula=line.trim().slice(2);
      while(!formula.endsWith(closing)&&i+1<lines.length)formula+='\n'+lines[++i];
      if(formula.endsWith(closing))formula=formula.slice(0,-2);
      out.push('<div class="math-block">'+katex.renderToString(formula,{output:'mathml',displayMode:true,throwOnError:false,trust:false,strict:'ignore',maxExpand:500})+'</div>');continue;
    }
    if(line.includes('|')&&i+1<lines.length){
      const headers=cells(line),separators=cells(lines[i+1]);
      if(headers.length>1&&headers.length===separators.length&&separators.every(s=>/^:?-{3,}:?$/.test(s))){
        flushP();flushL();const align=separators.map(s=>s.startsWith(':')&&s.endsWith(':')?'center':s.endsWith(':')?'right':'left'),row=(xs,tag)=>'<tr>'+headers.map((_,n)=>`<${tag} style="text-align:${align[n]}">${inline(xs[n]||'')}</${tag}>`).join('')+'</tr>';
        const rows=[];i++;while(i+1<lines.length&&lines[i+1].trim()&&lines[i+1].includes('|'))rows.push(row(cells(lines[++i]),'td'));
        out.push('<div class="message-table"><table><thead>'+row(headers,'th')+'</thead><tbody>'+rows.join('')+'</tbody></table></div>');continue;
      }
    }
    const heading=line.match(/^(#{1,3})\s+(.+)$/);const bullet=line.match(/^\s*(?:([-*])\s+|\d+[.)]\s+)(.+)$/);
    if(!line.trim()){flushP();flushL();continue;}
    if(heading){flushP();flushL();out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);continue;}
    if(bullet){flushP();const type=bullet[1]?'ul':'ol';if(listType&&listType!==type)flushL();listType=type;list.push(bullet[2]);continue;}
    if(/^>\s?/.test(line)){flushP();flushL();out.push(`<blockquote>${inline(line.replace(/^>\s?/,''))}</blockquote>`);continue;}
    flushL();paragraph.push(line);
  }
  flushP();flushL();if(code)flushCode();return out.join('\n');
}

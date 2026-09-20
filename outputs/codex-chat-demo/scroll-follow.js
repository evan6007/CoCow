export function createScrollFollow(box,button,{frame=requestAnimationFrame}={}) {
 let following=true,lastTop=box.scrollTop,touchY=null,inputUntil=0,revision=0,dragging=false;
 const input=()=>{inputUntil=Date.now()+800;revision++;};
 const bottom=()=>box.scrollHeight-box.scrollTop-box.clientHeight<=8;
 const sync=()=>{button.hidden=bottom();};
 const pause=()=>{following=false;sync();};
 box.addEventListener('wheel',e=>{input();if(e.deltaY<0)pause();},{passive:true});
 box.addEventListener('touchstart',e=>{input();touchY=e.touches[0]?.clientY;},{passive:true});
 box.addEventListener('touchmove',e=>{input();if(e.touches[0]?.clientY>touchY)pause();touchY=e.touches[0]?.clientY;},{passive:true});
 box.addEventListener('pointerdown',()=>{input();dragging=true;});
 box.addEventListener('pointerup',()=>{dragging=false;input();});
 box.addEventListener('pointercancel',()=>{dragging=false;});
 box.addEventListener('keydown',e=>{if(['ArrowUp','PageUp','Home','ArrowDown','PageDown','End',' '].includes(e.key))input();if(['ArrowUp','PageUp','Home'].includes(e.key))pause();});
 // DOM replacement and browser scroll anchoring also emit scroll events. They
 // must not be mistaken for someone scrolling upward and disable follow mode.
 box.addEventListener('scroll',()=>{if(dragging||Date.now()<inputUntil){if(box.scrollTop<lastTop-1)following=false;else if(bottom())following=true;}lastTop=box.scrollTop;sync();},{passive:true});
 const follow=()=>{if(following){box.scrollTop=box.scrollHeight;lastTop=box.scrollTop;}sync();};
 const latest=()=>{revision++;inputUntil=0;following=true;follow();};
 const capture=()=>({following,top:box.scrollTop,revision});
 const restore=s=>{if(s.revision!==revision)return;inputUntil=0;if(s.following&&following)follow();else if(!s.following){box.scrollTop=s.top;lastTop=box.scrollTop;sync();}};
 button.onclick=latest;
 const refresh=()=>{follow();frame(follow);};
 if(typeof document!=='undefined'){document.fonts?.ready.then(refresh);document.fonts?.addEventListener('loadingdone',refresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});}
 const observer=typeof ResizeObserver==='function'?new ResizeObserver(refresh):null;
 // Messages can grow after a render (fonts, tables, images). Observing only the
 // hidden welcome panel missed those changes and left new chats halfway up.
 if(observer){observer.observe(box);for(const child of box.children||[])observer.observe(child);}
 return {follow,latest,refresh,pause,capture,restore,isFollowing:()=>following};
}

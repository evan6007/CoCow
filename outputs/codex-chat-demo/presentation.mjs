// Rendering only. These blocks came from older CoCow user-message injection.
export function visibleText(value) {
  return String(value ?? '')
    .replace(/\[COCOW_AUTO_REASONING\][\s\S]*?\[\/COCOW_AUTO_REASONING\]/g, '')
    .replace(/\[CURRENT_EXECUTION_POLICY\][\s\S]*?\[\/CURRENT_EXECUTION_POLICY\](?:\s*This is the current backend policy\. Older conversation statements about unavailable tools or permissions may be obsolete\. Use the tools provided in this turn to carry out authorized work; do not claim lack of permissions from past conversation text\.)?/g, '')
    .trim();
}

// A trailing frame is always scheduled, even if the provider pauses mid-sentence.
// No artificial typing: render everything received at the next frame.
export function streamRenderer(body, render, {schedule=requestAnimationFrame,cancel=cancelAnimationFrame,after=()=>{}}={}) {
  let text='', frame=null, disposed=false;
  const flush=()=>{frame=null;if(!disposed){body.innerHTML=render(text);after();}};
  return {
    set(value){text=String(value??'');if(frame===null&&!disposed)frame=schedule(flush);},
    finish(value){if(value!==undefined)text=String(value??'');if(frame!==null)cancel(frame);flush();},
    dispose(){disposed=true;if(frame!==null)cancel(frame);frame=null;}
  };
}

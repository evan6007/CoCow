import {open} from 'node:fs/promises';
import {validateLocalPath} from './local-file-open.mjs';
export async function readLocalImage(input){
 const path=validateLocalPath(input),file=await open(path,'r');
 try{const st=await file.stat();if(!st.isFile()||st.size>25*1024*1024)throw Error('Image exceeds 25 MB or is not a file');const data=await file.readFile();
 const mime=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':data[0]===255&&data[1]===216&&data[2]===255?'image/jpeg':/^GIF8[79]a$/.test(data.subarray(0,6).toString())?'image/gif':data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP'?'image/webp':null;
 if(!mime)throw Error('Only PNG, JPEG, GIF and WebP images are supported');return {data,mime};
 }finally{await file.close();}
}

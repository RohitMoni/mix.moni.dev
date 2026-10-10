import { analyze, renderPrepared, wavBytes } from './engine.js?v=5';
self.onmessage=async({data})=>{
  const {id,task,payload}=data;
  try {
    let result;
    const progress=value=>self.postMessage({id,progress:value});
    if(task==='analyze')result=analyze(payload.channels,payload.sampleRate);
    else if(task==='render'){
      const channels=renderPrepared(payload.clips,payload.sampleRate,progress);
      if(payload.preview){
        const from=Math.max(0,Math.round(payload.preview.from*payload.sampleRate));
        const to=Math.min(channels[0].length,Math.round(payload.preview.to*payload.sampleRate));
        result=wavBytes(channels.map(ch=>ch.slice(from,to)),payload.sampleRate);
      }else result=wavBytes(channels,payload.sampleRate);
    }else if(task==='mp3'){
      // Vendor encoder is a classic script; load it into this worker's global scope.
      const response=await fetch('./vendor/lame.min.js');
      if(!response.ok)throw new Error('Could not load the MP3 encoder.');
      const source=await response.text();
      const encoderLibrary=new Function(`${source};return lamejs;`)();
      const encoder=new encoderLibrary.Mp3Encoder(2,payload.sampleRate,192),parts=[];
      const view=new DataView(payload.wav),frames=(payload.wav.byteLength-44)/4;
      for(let offset=0;offset<frames;offset+=1152){
        const size=Math.min(1152,frames-offset),l=new Int16Array(size),r=new Int16Array(size);
        for(let j=0;j<size;j++){l[j]=view.getInt16(44+(offset+j)*4,true);r[j]=view.getInt16(46+(offset+j)*4,true);}
        const encoded=encoder.encodeBuffer(l,r);if(encoded.length)parts.push(new Uint8Array(encoded));
        if(offset%(1152*50)===0)progress(offset/frames);
      }
      const tail=encoder.flush();if(tail.length)parts.push(new Uint8Array(tail));
      const size=parts.reduce((s,p)=>s+p.length,0),bytes=new Uint8Array(size);let cursor=0;
      for(const part of parts){bytes.set(part,cursor);cursor+=part.length;}result=bytes.buffer;
    }else throw new Error('Unknown audio operation.');
    self.postMessage({id,result},result instanceof ArrayBuffer?[result]:[]);
  }catch(error){self.postMessage({id,error:error.message||String(error)});}
};

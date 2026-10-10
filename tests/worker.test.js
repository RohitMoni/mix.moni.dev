import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
let handler;
const nativeFetch=globalThis.fetch;
globalThis.fetch=async url=>({ok:true,text:()=>readFile(new URL('../'+url,import.meta.url),'utf8')});
globalThis.self={onmessage:null,postMessage:data=>handler?.(data)};
await import('../worker.js');
function request(task,payload){return new Promise((resolve,reject)=>{handler=d=>{if('progress'in d)return;d.error?reject(new Error(d.error)):resolve(d.result);};self.onmessage({data:{id:1,task,payload}});});}
test('worker analyzes, renders WAV, and encodes a real stereo MP3',async()=>{
 const sr=44100,ch=Float32Array.from({length:sr*2},(_,i)=>Math.sin(2*Math.PI*440*i/sr)*.15);
 const analysis=await request('analyze',{channels:[ch,ch],sampleRate:sr});assert.ok(analysis.rms>.09);
 const wav=await request('render',{clips:[{channels:[ch,ch],rate:1,overlap:0}],sampleRate:sr});assert.equal(wav.byteLength,44+sr*2*4);
 const mp3=await request('mp3',{wav,sampleRate:sr});assert.ok(mp3.byteLength>10000);const bytes=new Uint8Array(mp3);assert.equal(bytes[0],255);assert.equal(bytes[1]&224,224);
 await assert.rejects(()=>request('unknown',{}),/Unknown audio operation/);
 globalThis.fetch=nativeFetch;
});

import {clamp} from './engine.js';

export const SONG_COLORS=['#ff6cac','#ac8bff','#79e4dd','#d9ff79','#ffac72','#81b9ff'];
// Mirror the renderer's sample-rounded durations and overlap caps.
export function mixLayout(plan,sampleRate=44100){
  const lengths=plan.clips.map(c=>{const samples=Math.round(c.end*sampleRate)-Math.round(c.start*sampleRate);return Math.abs(c.rate-1)<.001?samples:Math.round(samples/c.rate);});
  const overlaps=plan.clips.map((c,i)=>i===plan.clips.length-1?0:Math.min(Math.round(c.overlap*sampleRate),Math.floor(lengths[i]*.25),Math.floor(lengths[i+1]*.25)));
  let offset=0;
  const sections=plan.clips.map((c,i)=>{const start=offset,end=offset+lengths[i];offset=end-overlaps[i];return {...c,index:i,startTime:start/sampleRate,endTime:end/sampleRate,transitionTime:(end-overlaps[i]/2)/sampleRate,color:SONG_COLORS[i%SONG_COLORS.length]};});
  return {sections,duration:offset/sampleRate};
}
export function waveformPeaks(wav,columns=360){
  const view=new DataView(wav),channels=view.getUint16(22,true),frames=view.getUint32(40,true)/(channels*2);
  const peaks=new Float32Array(columns);
  for(let k=0;k<columns;k++){
    const from=Math.floor(k*frames/columns),to=Math.floor((k+1)*frames/columns);let peak=0;
    for(let i=from;i<to;i+=Math.max(1,Math.floor((to-from)/80)))for(let ch=0;ch<channels;ch++)peak=Math.max(peak,Math.abs(view.getInt16(44+(i*channels+ch)*2,true))/32768);
    peaks[k]=peak;
  }
  return peaks;
}
export function drawMix(canvas,wav,layout){
  const ctx=canvas.getContext('2d');if(!ctx)return;
  const {width,height}=canvas,peaks=waveformPeaks(wav),bar=width/peaks.length;
  ctx.clearRect(0,0,width,height);
  for(const section of layout.sections){ctx.fillStyle=section.color+'0c';ctx.fillRect(section.startTime/layout.duration*width,0,(section.endTime-section.startTime)/layout.duration*width,height);}
  const boundaries=layout.sections.slice(0,-1).map(s=>s.transitionTime);
  for(let i=0;i<peaks.length;i++){
    const time=(i+.5)/peaks.length*layout.duration,index=boundaries.filter(t=>t<=time).length;
    ctx.fillStyle=layout.sections[index]?.color||SONG_COLORS[0];
    const amplitude=clamp(peaks[i]*height*.45,2,height*.46);
    ctx.fillRect(i*bar+1,height/2-amplitude,Math.max(1,bar-2),amplitude*2);
  }
}

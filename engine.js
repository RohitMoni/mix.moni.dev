// Pure audio analysis/planning/DSP, shared by the worker and Node tests.
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export function parseTime(value) {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text) && !/^\d+:\d{2}(?:\.\d+)?$/.test(text)) return NaN;
  const parts = text.split(':').map(Number);
  if (parts.length === 2 && parts[1] >= 60) return NaN;
  return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
}
export function formatTime(s) {
  if (!Number.isFinite(s)) return '—';
  s = Math.max(0, Math.round(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function youtubeUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    let id;
    if (u.hostname === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(u.hostname)) {
      id = u.searchParams.get('v') || (/^\/(shorts|embed|live)\//.test(u.pathname) ? u.pathname.split('/')[2] : null);
    }
    return /^[a-zA-Z0-9_-]{11}$/.test(id || '') ? `https://www.youtube.com/watch?v=${id}` : null;
  } catch { return null; }
}
export function analyze(channels, sampleRate) {
  const length = channels[0].length, hop = Math.round(sampleRate / 100);
  const count = Math.ceil(length / hop), energy = new Float32Array(count), lowEnergy = new Float32Array(count);
  let filtered = 0, sum = 0, peak = 0;
  const alpha = 1 - Math.exp(-2 * Math.PI * 180 / sampleRate);
  for (let block = 0; block < count; block++) {
    let e = 0, low = 0, n = 0;
    for (let i = block * hop; i < Math.min(length, (block + 1) * hop); i++) {
      let v = 0;
      for (const ch of channels) v += ch[i] / channels.length;
      filtered += alpha * (v - filtered);
      e += v * v; low += filtered * filtered; n++;
      sum += v * v; peak = Math.max(peak, Math.abs(v));
    }
    energy[block] = Math.sqrt(e / Math.max(1,n)); lowEnergy[block] = Math.sqrt(low / Math.max(1,n));
  }
  const onset = new Float32Array(count);
  let onsetSum = 0;
  for (let i = 1; i < count; i++) {
    onset[i] = Math.max(0, lowEnergy[i] - lowEnergy[i-1]) + .35 * Math.max(0, energy[i]-energy[i-1]);
    onsetSum += onset[i];
  }
  const fps = sampleRate / hop;
  let bestScore = 0, bestBpm = 120;
  // Evaluate a representative three-minute window; aggregate onset autocorrelation.
  const size = Math.min(count, Math.round(fps * 180));
  const offset = Math.max(0, Math.floor((count-size)/2));
  for (let bpm = 70; bpm <= 180; bpm += .5) {
    const lag = fps * 60 / bpm;
    let score = 0, norm = 0;
    for (let i = Math.ceil(lag); i < size; i++) {
      const index = i-lag, j = Math.floor(index), frac = index-j;
      const past = onset[offset+j]*(1-frac) + onset[offset+j+1]*frac;
      score += onset[offset+i]*past; norm += onset[offset+i]**2;
    }
    score /= Math.max(1e-10,norm);
    if (score > bestScore) { bestScore=score; bestBpm=bpm; }
  }
  const reliable = bestScore > .18 && onsetSum > .001 && length/sampleRate >= 8;
  const bpm = reliable ? bestBpm : null;
  const period = fps * 60 / bestBpm;
  let bestPhase = 0, phaseScore = -1;
  for (let phase = 0; phase < Math.ceil(period); phase++) {
    let score = 0;
    for (let p = phase; p < count; p += period) {
      const i = Math.round(p); score += Math.max(...Array.from({length:5},(_,k)=>onset[clamp(i+k-2,0,count-1)]));
    }
    if (score > phaseScore) {phaseScore=score;bestPhase=phase;}
  }
  // Infer a four-beat phase from repeated onset accents. This is a heuristic,
  // not a semantic detector of bars, phrases, or drops.
  let accent = 0, accentScore = -1;
  for (let k = 0; k < 4; k++) {
    let score = 0;
    for (let p = bestPhase+k*period; p < count; p += 4*period) score += onset[Math.round(p)] || 0;
    if (score > accentScore) {accentScore=score;accent=k;}
  }
  const energyStep = .25, levels = [];
  for (let p = 0; p < count; p += fps*energyStep) {
    let e = 0, n = 0;
    for (let i=Math.floor(p);i<Math.min(count,Math.ceil(p+fps*energyStep));i++){e+=energy[i];n++;}
    levels.push(e/Math.max(1,n));
  }
  return {bpm, confidence: clamp(bestScore,0,1), beatOffset:bestPhase/fps,
    barOffset:(bestPhase+accent*period)/fps, energy:levels, energyStep,
    rms:Math.sqrt(sum/Math.max(1,length)), peak, duration:length/sampleRate};
}
function level(a, t) { return a?.energy?.[clamp(Math.floor(t/(a.energyStep||.25)),0,a.energy.length-1)] || 0; }
function snapped(t, track, margin, targetEnergy=null, min=0, max=track.duration) {
  const a=track.analysis, bpm=(a?.bpm||0)*(track.pace||1);
  if (!margin || !bpm) return t;
  const bar=240/bpm, origin=a.barOffset || 0;
  let best=t, bestScore=Infinity;
  const reference=Math.max(.01, a.rms || .1);
  for(let k=Math.floor((t-margin-origin)/bar);k<=Math.ceil((t+margin-origin)/bar);k++){
    const p=origin+k*bar;
    if(p<min||p>max||Math.abs(p-t)>margin)continue;
    let score=Math.abs(p-t)/Math.max(.1,margin)*.4;
    if(targetEnergy!==null) score+=Math.abs(level(a,p)/reference-targetEnergy);
    else score-=Math.max(0,level(a,p+.5)-level(a,p-.5))/reference*.3;
    if(score<bestScore){bestScore=score;best=p;}
  }
  return best;
}
export function transitionDecision(a,b) {
  const aa=a.analysis,bb=b.analysis;
  if(!aa||!bb)return {offerChoice:false,style:'smooth',reason:'Attach both songs to find their transition.'};
  const bpmA=(aa.bpm||0)*(a.pace||1),bpmB=(bb.bpm||0)*(b.pace||1);
  const equivalents=[bpmB/2,bpmB,bpmB*2];
  const mismatch=bpmA?Math.min(...equivalents.map(x=>Math.abs(x/bpmA-1))):1;
  const outgoing=level(aa,Math.max(a.start,a.end-.5))/Math.max(.01,aa.rms);
  const incoming=level(bb,b.start+.5)/Math.max(.01,bb.rms);
  const rise=(level(aa,Math.min(a.duration,a.end+.5))-level(aa,Math.max(a.start,a.end-1)))/Math.max(.01,aa.rms);
  const cleanPulse=aa.confidence>.42&&bb.confidence>.42&&bpmA&&bpmB;
  const energyFit=outgoing>.7&&incoming>.7&&Math.abs(outgoing-incoming)<.65;
  const distinct=rise>.22||(outgoing>1.05&&incoming>1.05);
  if(cleanPulse&&mismatch<.20&&energyFit&&rise>.8) return {offerChoice:false,style:'energy',reason:'A quick rhythmic handoff fits this energy lift best.'};
  const offerChoice=Boolean(cleanPulse&&mismatch<.20&&energyFit&&distinct&&a.end-a.start>=8&&b.end-b.start>=8);
  return {offerChoice,style:offerChoice?'energy':'smooth',reason:offerChoice?'Two distinct ways to carry the momentum.':'A smooth blend fits these moments best.'};
}
export function planMix(tracks, flex, choices={}, tempoChoices={}) {
  if(tracks.length<2)throw new Error('Add at least two songs to make a mix.');
  flex=clamp(flex,0,100);
  const clips=tracks.map(t=>{
    if(!t.analysis)throw new Error(`Attach audio to ${t.name}.`);
    if(!Number.isFinite(t.start)||!Number.isFinite(t.end)||t.start<0||t.end>t.duration+.01||t.end-t.start<3)throw new Error(`Choose at least three seconds within ${t.name}.`);
    return {id:t.id,start:t.start,end:Math.min(t.end,t.duration),rate:1,overlap:0,style:null};
  });
  const margin=flex/100*8;
  for(let i=0;i<tracks.length-1;i++){
    const a=tracks[i],b=tracks[i+1], left=clips[i],right=clips[i+1];
    const key=`${a.id}:${b.id}`, recommendation=transitionDecision(a,b);
    const style=recommendation.offerChoice ? (choices[key] || recommendation.style) : recommendation.style;
    left.style=style;
    left.end=snapped(a.end,a,margin,null,left.start+3,a.duration);
    const intensity=level(a.analysis,left.end-.25)/Math.max(.01,a.analysis.rms);
    right.start=snapped(b.start,b,margin,style==='energy'?intensity:null,0,b.end-3);
    const bpmA=(a.analysis.bpm||0)*(a.pace||1),bpmB=(b.analysis.bpm||0)*(b.pace||1);
    if(bpmA&&bpmB&&flex>0){
      const candidates=[bpmB/2,bpmB,bpmB*2];
      const equivalent=candidates.reduce((best,n)=>Math.abs(n-bpmA)<Math.abs(best-bpmA)?n:best,bpmB);
      const target=bpmA*left.rate;
      // No extreme retiming: near tempos converge, distant tempos keep their character.
      const maxShift=flex/100*.12;
      const desired=target/equivalent;
      right.rate=Math.abs(desired-1)<=.20?clamp(desired,1-maxShift,1+maxShift):1;
    }
    if(tempoChoices[b.id]==='original')right.rate=1;
    const beat=60/(bpmA*left.rate||120);
    const intended=style==='energy'?Math.max(.12,beat*.5):beat*8;
    left.overlap=Math.min(intended,(left.end-left.start)/left.rate*.25,(right.end-right.start)/right.rate*.25);
  }
  let duration=0;
  for(const clip of clips){duration+=(clip.end-clip.start)/clip.rate-clip.overlap;}
  if(duration>12*60)throw new Error('Keep the mix under 12 minutes for this browser version.');
  return {clips,duration};
}
// Waveform similarity overlap-add. Timing changes without resampling/pitch shift.
// Stereo channels share alignment offsets to preserve their relationship.
export function stretch(channels, rate, sampleRate) {
  if(Math.abs(rate-1)<.001)return channels;
  const inputLength=channels[0].length, length=Math.round(inputLength/rate);
  const frame=sampleRate>=40000?2048:1024, hop=frame/2, search=128;
  const output=channels.map(()=>new Float32Array(length)), weights=new Float32Array(length);
  const window=Float32Array.from({length:frame},(_,i)=>.5-.5*Math.cos(2*Math.PI*(i+.5)/frame));
  for(let out=0;out<length;out+=hop){
    const predicted=Math.round(out*rate);
    let start=clamp(predicted,0,Math.max(0,inputLength-frame)),best=-Infinity;
    if(out>0&&predicted+frame+search<inputLength){
      for(let candidate=Math.max(0,predicted-search);candidate<=predicted+search;candidate+=8){
        let dot=0,x2=0,y2=0;
        for(let i=0;i<hop&&out+i<length;i+=16){
          const x=output[0][out+i]/Math.max(1e-6,weights[out+i]),y=channels[0][candidate+i];
          dot+=x*y;x2+=x*x;y2+=y*y;
        }
        const similarity=dot/Math.sqrt(Math.max(1e-12,x2*y2));
        if(similarity>best){best=similarity;start=candidate;}
      }
    }
    for(let j=0;j<frame&&out+j<length&&start+j<inputLength;j++){
      weights[out+j]+=window[j];
      for(let ch=0;ch<channels.length;ch++)output[ch][out+j]+=channels[ch][start+j]*window[j];
    }
  }
  for(let i=0;i<length;i++)for(let ch=0;ch<output.length;ch++)output[ch][i]/=Math.max(1e-8,weights[i]);
  return output;
}
export function renderPrepared(clips,sampleRate,onProgress=()=>{}) {
  let prepared=clips.map((c,i)=>{
    const channels=stretch(c.channels,c.rate,sampleRate);
    onProgress((i+1)/(clips.length+1));
    let square=0,count=0;
    for(let s=0;s<channels[0].length;s+=8)for(const ch of channels){square+=ch[s]**2;count++;}
    const rms=Math.sqrt(square/Math.max(1,count));
    return {...c,channels,gain:Number.isFinite(c.gain)?c.gain:(rms>.0001?clamp(.15/rms,.25,2.5):1)};
  });
  const lengths=prepared.map(c=>c.channels[0].length);
  const overlaps=prepared.map((c,i)=>i===prepared.length-1?0:Math.min(Math.round(c.overlap*sampleRate),Math.floor(lengths[i]*.25),Math.floor(lengths[i+1]*.25)));
  const total=lengths.reduce((s,n,i)=>s+n-overlaps[i],0);
  const output=[new Float32Array(total),new Float32Array(total)];
  let offset=0;
  for(let k=0;k<prepared.length;k++){
    const c=prepared[k],len=lengths[k],fadeIn=k>0?overlaps[k-1]:Math.min(Math.round(sampleRate*.015),len),fadeOut=k<prepared.length-1?overlaps[k]:Math.min(Math.round(sampleRate*.025),len);
    for(let i=0;i<len;i++){
      let g=c.gain;
      if(i<fadeIn)g*=k?Math.sin(i/fadeIn*Math.PI/2):i/fadeIn;
      if(i>=len-fadeOut)g*=k<prepared.length-1?Math.cos((i-(len-fadeOut))/fadeOut*Math.PI/2):(len-i-1)/fadeOut;
      output[0][offset+i]+=c.channels[0][i]*g;
      output[1][offset+i]+=(c.channels[1]||c.channels[0])[i]*g;
    }
    offset+=len-overlaps[k];
  }
  let peak=0;
  for(let i=0;i<total;i++)peak=Math.max(peak,Math.abs(output[0][i]),Math.abs(output[1][i]));
  const limiter=peak>.97?.97/peak:1;
  for(const ch of output)for(let i=0;i<ch.length;i++)ch[i]*=limiter;
  onProgress(1);return output;
}
export function wavBytes(channels,sampleRate) {
  const frames=channels[0].length,n=channels.length;
  const bytes=new ArrayBuffer(44+frames*n*2),v=new DataView(bytes);
  const str=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
  str(0,'RIFF');v.setUint32(4,bytes.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,n,true);v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*n*2,true);v.setUint16(32,n*2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,frames*n*2,true);
  for(let i=0;i<frames;i++)for(let c=0;c<n;c++){const s=clamp(channels[c][i],-1,1);v.setInt16(44+(i*n+c)*2,Math.round(s*(s<0?32768:32767)),true);}
  return bytes;
}

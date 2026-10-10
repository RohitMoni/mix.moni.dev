import {mixLayout,drawMix} from './results.js';
import {fetchYoutubeTitle} from './youtube.js';
import {parseTime,formatTime,youtubeUrl,planMix,transitionDecision,wavBytes,clamp} from './engine.js';
const $=id=>document.getElementById(id), SR=44100, buffers=new Map(), worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'}), jobs=new Map();
let seq=0,db=null,context=null,busy=false,wav=null,finalUrl=null,previewUrl=null,resultPlan=null,layout=null,activeChoice=null;
let project={tracks:[],flex:50,choices:{},tempoChoices:{}};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function status(s,error=false){$('status').textContent=s;$('status').classList.toggle('error',error);}
function ctx(){return context||(context=new AudioContext({sampleRate:SR}));}
function run(task,payload,progress){return new Promise((resolve,reject)=>{const id=++seq;jobs.set(id,{resolve,reject,progress});worker.postMessage({id,task,payload});});}
worker.onmessage=({data:d})=>{const j=jobs.get(d.id);if(!j)return;if('progress'in d){j.progress?.(d.progress);return;}jobs.delete(d.id);d.error?j.reject(new Error(d.error)):j.resolve(d.result);};
worker.onerror=()=>{for(const j of jobs.values())j.reject(new Error('Audio processing stopped. Reload and try shorter excerpts.'));jobs.clear();};
function openDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open('mix-moni-v1',1);r.onupgradeneeded=()=>{r.result.createObjectStore('project');r.result.createObjectStore('audio');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('Close other tabs to open storage.'));});}
function get(store,key){return new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function save(id=null,blob=null,remove=null){if(!db){status('Browser storage is unavailable. This session is not saved.',true);return;}await new Promise((resolve,reject)=>{const tx=db.transaction(['project','audio'],'readwrite');tx.objectStore('project').put(project,'current');if(id&&blob)tx.objectStore('audio').put(blob,id);if(remove)tx.objectStore('audio').delete(remove);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);}).catch(()=>{document.querySelector('.local').textContent='Session not saved';throw new Error('Browser storage is full or unavailable. The latest changes were not saved. You can still use this session.');});}
function invalidate(){scrubPointer=null;$('mix-waveform').classList.remove('scrubbing');wav=null;resultPlan=null;layout=null;activeChoice=null;$('transition-section').hidden=true;for(const id of ['final-player','preview-player']){const p=$(id);p.pause();p.removeAttribute('src');p.load();}$('output').hidden=true;$('preview-player').hidden=true;if(finalUrl)URL.revokeObjectURL(finalUrl);if(previewUrl)URL.revokeObjectURL(previewUrl);finalUrl=previewUrl=null;}
function setBusy(v){busy=v;document.querySelectorAll('button,input').forEach(el=>el.disabled=v);if(!v){$('render').disabled=project.tracks.length<2||project.tracks.some(t=>!buffers.has(t.id));document.querySelectorAll('[data-act="up"]').forEach((b,i)=>b.disabled=i===0);document.querySelectorAll('[data-act="down"]').forEach((b,i)=>b.disabled=i===project.tracks.length-1);document.querySelectorAll('[data-field="start"],[data-field="end"]').forEach(el=>el.disabled=!buffers.has(el.closest('[data-id]').dataset.id));}}
async function action(fn){if(busy)return;setBusy(true);try{await fn();}catch(e){status(e.message||String(e),true);}finally{setBusy(false);}}
function flexText(){const f=project.flex;$('flex-label').textContent=f===0?'Fixed':f<35?'Low':f<70?'Medium':'High';$('flex-description').textContent=f===0?'Exact excerpt times; no tempo changes.':f<35?'Minimal timing and tempo adjustments.':f<70?'Small timing shifts and gentle tempo matching.':'Larger timing shifts and tempo adjustments.';}
async function resolveTrackTitle(t){
  t.titleStatus='loading';display();
  try{
    const title=await fetchYoutubeTitle(t.url);
    if(!project.tracks.includes(t))return;
    t.youtubeTitle=title;t.titleStatus='ready';if(!t.nameEdited)t.name=title;
  }catch{if(!project.tracks.includes(t))return;t.titleStatus='unavailable';}
  display();if(wav&&resultPlan)resultNotes();try{await save();}catch(e){status(e.message,true);}
}
function display(){
const active=document.activeElement;const editing=active?.dataset?.field?{id:active.closest('[data-id]')?.dataset.id,field:active.dataset.field,value:active.value,start:active.selectionStart,end:active.selectionEnd}:null;
$('flex').value=project.flex;flexText();
$('tracks').innerHTML=project.tracks.map((t,i)=>{
  const ready=buffers.has(t.id);
  const subtitle=[t.url?`<a href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">YouTube ↗</a>`:'Audio file',t.duration?formatTime(t.duration):'',t.titleStatus==='loading'?'Fetching title…':t.titleStatus==='unavailable'?'Title unavailable; edit name above':''].filter(Boolean).join('<span>·</span>');
  const fileInput=label=>`<label class="secondary file-button">${label}<input type="file" accept="audio/*" data-audio="${t.id}"></label>`;
  return `<article class="track" data-id="${t.id}"><div class="track-row"><span class="track-num">${i+1}</span><div class="track-name"><input data-field="name" value="${esc(t.name)}" title="${esc(t.name)}" aria-label="Song ${i+1} name"><div class="track-sub">${subtitle}</div></div><div class="clip"><label>From<input data-field="start" inputmode="decimal" type="text" value="${formatTime(t.start)}" aria-label="${esc(t.name)} excerpt start"></label><span class="clip-arrow">→</span><label>To<input data-field="end" inputmode="decimal" type="text" value="${formatTime(t.end)}" aria-label="${esc(t.name)} excerpt end"></label></div><div class="audio-state">${ready?'✓ Ready':fileInput('Attach audio')}</div><div class="track-actions"><button data-act="up" aria-label="Move ${esc(t.name)} earlier" title="Move earlier">↑</button><button data-act="down" aria-label="Move ${esc(t.name)} later" title="Move later">↓</button><button data-act="remove" aria-label="Remove ${esc(t.name)}" title="Remove song">×</button></div></div>${ready?`<details class="track-options"><summary>Options</summary><div class="track-option-content">${fileInput('Replace audio')}${t.analysis?.bpm?`<span>Estimated pace: ${Math.round(t.analysis.bpm*(t.pace||1))}${t.analysis.confidence<.42?' (uncertain)':''}</span><details class="correction"><summary>Correct pace</summary><p>Adjust the rhythm estimate; the original audio stays unchanged.</p><button class="secondary" data-act="slower">Slower</button><button class="secondary" data-act="reset">Reset</button><button class="secondary" data-act="faster">Faster</button></details>`:'<span>No steady rhythm detected; smooth blending.</span>'}</div></details>`:''}</article>`;
}).join('');
$('empty').hidden=project.tracks.length>0;$('more-files').hidden=project.tracks.length===0;$('song-count').textContent=project.tracks.length;
try{$('mix-duration').textContent=formatTime(planMix(project.tracks,project.flex,project.choices,project.tempoChoices).duration);}catch{$('mix-duration').textContent='—';}
setBusy(busy);
if(editing){const row=[...document.querySelectorAll('[data-id]')].find(el=>el.dataset.id===editing.id);const input=row?.querySelector(`[data-field="${editing.field}"]`);if(input){input.value=editing.value;input.focus({preventScroll:true});try{input.setSelectionRange(editing.start,editing.end);}catch{}}}
}
// Result annotations use stable song IDs or transition pairs. These anchors
// can later carry comments/proposals without depending on rendered positions.
function resultNotes(){
  layout=mixLayout(resultPlan,SR);
  drawMix($('mix-waveform'),wav,layout);
  const at=time=>clamp(time/layout.duration*100,6,94);
  const line=time=>clamp(time/layout.duration*100,0,100);
  const transitionNotes=[];
  $('transition-lines').innerHTML=layout.sections.slice(0,-1).map((part,i)=>{
    const a=project.tracks[i],b=project.tracks[i+1],d=transitionDecision(a,b);
    if(d.offerChoice)transitionNotes.push(`<button class="map-note" style="left:${at(part.transitionTime)}%" data-choice="transition" data-anchor="${a.id}:${b.id}" data-index="${i}" title="${esc(a.name)} → ${esc(b.name)}" aria-label="Compare transition options from ${esc(a.name)} to ${esc(b.name)}">${i+1} → ${i+2} · Options <span>↗</span></button>`);
    return `<span class="transition-line" style="left:${line(part.transitionTime)}%"></span>`;
  }).join('');
  $('top-notes').innerHTML=transitionNotes.join('');
  const tempoNotes=[];
  for(let i=1;i<layout.sections.length;i++){
    const t=project.tracks[i],alternative=planMix(project.tracks,project.flex,project.choices,{...project.tempoChoices,[t.id]:'auto'}).clips[i];
    if(Math.abs(alternative.rate-1)<.01)continue;
    const part=layout.sections[i],original=project.tempoChoices[t.id]==='original';
    tempoNotes.push(`<button class="map-note tempo-note" style="left:${at((part.startTime+part.endTime)/2)}%" data-choice="tempo" data-anchor="${t.id}" data-index="${i}" title="${esc(t.name)}" aria-label="Review tempo adjustment for ${esc(t.name)}">${i+1} · ${original?'Original pace':'Pace matched'} <span>↗</span></button>`);
  }
  $('bottom-notes').innerHTML=tempoNotes.join('');
  $('top-notes').hidden=!transitionNotes.length;$('bottom-notes').hidden=!tempoNotes.length;
  const hasChoices=transitionNotes.length||tempoNotes.length;
  $('result-description').textContent=hasChoices?'Click a note to preview a different transition or pace.':'Transitions were selected automatically. Your mix is ready.';
  $('song-legend').innerHTML=layout.sections.map((part,i)=>`<span><i style="background:${part.color}"></i>${i+1}. ${esc(project.tracks[i].name)}</span>`).join('');
  $('result-duration').textContent=formatTime(layout.duration);
  arrangeNotes($('top-notes'));arrangeNotes($('bottom-notes'));updatePlayhead();
}
function arrangeNotes(lane){
  if(window.innerWidth<=650){lane.style.height='';return;}
  const ends=[],width=lane.clientWidth;
  for(const button of lane.querySelectorAll('button')){
    const size=button.offsetWidth,center=clamp(parseFloat(button.style.left)/100*width,size/2+4,width-size/2-4),left=center-size/2;
    let row=ends.findIndex(end=>end+12<=left);if(row<0)row=ends.length;ends[row]=left+size;
    button.style.left=center+'px';button.style.setProperty('--stem',(row*42+8)+'px');
    if(lane.classList.contains('bottom-lane'))button.style.top=(row*42+10)+'px';else button.style.bottom=(row*42+10)+'px';
  }
  lane.style.height=Math.max(50,ends.length*42+10)+'px';
}
window.addEventListener('resize',()=>{if(wav&&resultPlan)resultNotes();});
function closeChoice(){activeChoice=null;$('transition-section').hidden=true;$('preview-player').pause();}
function showChoice(type,i){
  activeChoice={type,index:i};$('transition-section').hidden=false;$('preview-player').pause();$('preview-player').hidden=true;
  if(type==='transition'){
    const a=project.tracks[i],b=project.tracks[i+1],key=`${a.id}:${b.id}`,chosen=project.choices[key]||transitionDecision(a,b).style;
    $('transition-title').textContent=`${a.name} → ${b.name}`;
    $('transition-description').textContent='Listen to both. Choosing one updates the mix and downloads.';
    $('transitions').innerHTML=`<div class="options">${[['energy','A','Keep the energy up','A quick transition aligned to the rhythm.'],['smooth','B','Blend smoothly','A longer crossfade between the songs.']].map(([style,letter,title,description])=>`<div class="option ${chosen===style?'selected':''}"><div class="option-head"><span class="letter">${letter}</span><h3>${title}</h3></div><p>${description}</p><div class="option-buttons"><button class="secondary" data-preview="${i}" data-style="${style}">▶ Listen ${letter}</button><button class="secondary pick" data-pick="${i}" data-style="${style}" aria-pressed="${chosen===style}">${chosen===style?'✓ Selected':`Use ${letter}`}</button></div></div>`).join('')}</div>`;
  }else{
    const t=project.tracks[i],auto=planMix(project.tracks,project.flex,project.choices,{...project.tempoChoices,[t.id]:'auto'}).clips[i],bpm=t.analysis.bpm*(t.pace||1),original=project.tempoChoices[t.id]==='original';
    $('transition-title').textContent=t.name+' · pace';
    $('transition-description').textContent='Matching pace helps the songs connect. Keeping the original may make the change in rhythm more noticeable.';
    $('transitions').innerHTML=`<div class="options">${[['auto','Matched pace',`${Math.round(bpm*auto.rate)} estimated BPM · smoother rhythm between songs`,!original],['original','Original pace',`${Math.round(bpm)} estimated BPM · keeps the song’s original feel`,original]].map(([value,title,description,chosen])=>`<div class="option ${chosen?'selected':''}"><h3>${title}</h3><p>${description}</p><div class="option-buttons"><button class="secondary" data-tempo-preview="${i}" data-value="${value}">▶ Listen</button><button class="secondary pick" data-tempo-pick="${i}" data-value="${value}" aria-pressed="${chosen}">${chosen?'✓ Selected':'Use this'}</button></div></div>`).join('')}</div>`;
  }
  setBusy(busy);
}
function updatePlayhead(){
  if(!layout)return;
  const player=$('final-player'),duration=Number.isFinite(player.duration)&&player.duration>0?player.duration:layout.duration;
  const time=clamp(player.currentTime,0,duration),waveform=$('mix-waveform');
  $('playhead').style.left=clamp(time/duration*100,0,100)+'%';
  waveform.setAttribute('aria-valuemax',String(Math.round(duration)));
  waveform.setAttribute('aria-valuenow',String(Math.round(time)));
  waveform.setAttribute('aria-valuetext',`${formatTime(time)} of ${formatTime(duration)}`);
}
const waveform=$('mix-waveform');
let scrubPointer=null;
function seekWaveform(clientX){
  const player=$('final-player'),bounds=waveform.getBoundingClientRect();
  if(!wav||!layout||player.readyState<1||bounds.width<=0)return;
  const duration=Number.isFinite(player.duration)&&player.duration>0?player.duration:layout.duration;
  player.currentTime=clamp((clientX-bounds.left)/bounds.width,0,1)*duration;
  updatePlayhead();
}
waveform.addEventListener('pointerdown',e=>{
  if(!wav||!layout||busy||e.button!==0||!e.isPrimary)return;
  scrubPointer=e.pointerId;waveform.setPointerCapture(e.pointerId);
  waveform.classList.add('scrubbing');waveform.focus({preventScroll:true});
  seekWaveform(e.clientX);e.preventDefault();
});
waveform.addEventListener('pointermove',e=>{if(e.pointerId===scrubPointer)seekWaveform(e.clientX);});
function finishScrub(e){
  if(e.pointerId!==scrubPointer)return;
  if(e.type==='pointerup')seekWaveform(e.clientX);
  scrubPointer=null;waveform.classList.remove('scrubbing');
  if(waveform.hasPointerCapture(e.pointerId))waveform.releasePointerCapture(e.pointerId);
}
for(const event of ['pointerup','pointercancel','lostpointercapture'])waveform.addEventListener(event,finishScrub);
waveform.addEventListener('keydown',e=>{
  const player=$('final-player');if(!wav||!layout||busy||player.readyState<1)return;
  const duration=Number.isFinite(player.duration)&&player.duration>0?player.duration:layout.duration;
  let time=player.currentTime;
  if(e.key==='ArrowLeft'||e.key==='ArrowDown')time-=e.shiftKey?15:5;
  else if(e.key==='ArrowRight'||e.key==='ArrowUp')time+=e.shiftKey?15:5;
  else if(e.key==='Home')time=0;else if(e.key==='End')time=duration;else return;
  e.preventDefault();player.currentTime=clamp(time,0,duration);updatePlayhead();
});
$('final-player').ontimeupdate=updatePlayhead;
$('final-player').onloadedmetadata=updatePlayhead;
$('final-player').onseeking=updatePlayhead;
$('close-choice').onclick=closeChoice;
document.querySelector('.mix-map').onclick=e=>{const button=e.target.closest('[data-choice]');if(button&&!busy){showChoice(button.dataset.choice,Number(button.dataset.index));$('transition-section').scrollIntoView({behavior:'smooth',block:'nearest'});}};
async function renderMix({focus=false}={}){
  $('preview-player').pause();$('final-player').pause();
  const plan=planMix(project.tracks,project.flex,project.choices,project.tempoChoices);
  status('Rendering mix…');
  const bytes=await run('render',payloadFor(plan),p=>status(`Rendering mix… ${Math.round(p*100)}%`));
  wav=bytes;resultPlan=plan;if(finalUrl)URL.revokeObjectURL(finalUrl);finalUrl=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
  $('final-player').src=finalUrl;$('output').hidden=false;$('output-note').textContent='Download to keep this mix. Choices are saved in this browser.';
  resultNotes();if(activeChoice)showChoice(activeChoice.type,activeChoice.index);
  status('Mix ready. Play, review notes, or download.');
  if(focus){$('output').scrollIntoView({behavior:'smooth',block:'start'});$('result-title').focus({preventScroll:true});}
}
async function previewPlan(plan,pair){
  $('preview-player').pause();$('final-player').pause();status('Rendering preview…');
  const bytes=await run('render',payloadFor(plan,pair));
  if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
  const player=$('preview-player');player.src=previewUrl;player.hidden=false;
  try{await player.play();status('Playing preview.');}catch{status('Preview ready. Tap play.');}
}
function newTrack(name,url=''){if(project.tracks.length>=12)throw new Error('This version supports up to 12 songs.');return {id:crypto.randomUUID(),name,url,start:0,end:60,pace:1,duration:0,analysis:null};}
async function attach(t,file){if(file.size>80*1024*1024)throw new Error('Choose a file smaller than 80 MB.');status(`Opening ${file.name||t.name}…`);let b;try{b=await ctx().decodeAudioData(await file.arrayBuffer());}catch{throw new Error('This browser could not open that audio. Try an MP3 or WAV file.');}if(b.duration<3)throw new Error('Choose audio at least three seconds long.');if(project.tracks.reduce((s,x)=>s+(x.id===t.id?0:x.duration||0),0)+b.duration>900)throw new Error('Keep attached audio under 15 minutes total. Shorter files work best on phones.');const channels=Array.from({length:Math.min(2,b.numberOfChannels)},(_,i)=>b.getChannelData(i));status(`Finding the rhythm in ${t.name}…`);const analysis=await run('analyze',{channels,sampleRate:b.sampleRate});Object.assign(t,{duration:b.duration,analysis,pace:1,start:0,end:Math.min(60,b.duration)});if(!t.youtubeTitle&&!t.nameEdited)t.name=file.name.replace(/\.[^.]+$/,'');buffers.set(t.id,b);invalidate();display();await save(t.id,file);status(`${t.name} is ready.`);}
async function addFiles(files){for(const f of files){const t=newTrack(f.name.replace(/\.[^.]+$/,''));project.tracks.push(t);try{await attach(t,f);}catch(e){if(!buffers.has(t.id)){project.tracks=project.tracks.filter(x=>x.id!==t.id);display();}throw e;}}}
$('add-form').onsubmit=e=>{e.preventDefault();action(async()=>{const url=youtubeUrl($('youtube').value);if(!url)throw new Error('Paste a valid YouTube video link.');const t=newTrack('YouTube · '+new URL(url).searchParams.get('v'),url);project.tracks.push(t);$('youtube').value='';invalidate();display();await save();status('Song added. Attach its audio.');void resolveTrackTitle(t);});};
for(const id of ['direct-file','more-file'])$(id).onchange=e=>{const files=[...e.target.files];e.target.value='';action(()=>addFiles(files));};
$('tracks').oninput=e=>{if(e.target.dataset.field==='name'){const t=project.tracks.find(x=>x.id===e.target.closest('[data-id]').dataset.id);if(t)t.nameEdited=true;}};
$('tracks').onchange=e=>{if(e.target.dataset.audio){const t=project.tracks.find(x=>x.id===e.target.dataset.audio),f=e.target.files[0];e.target.value='';if(f)action(()=>attach(t,f));return;}const field=e.target.dataset.field;if(!field)return;const t=project.tracks.find(x=>x.id===e.target.closest('[data-id]').dataset.id);action(async()=>{if(field==='name'){t.name=e.target.value.trim()||'Untitled song';t.nameEdited=true;}else{const value=parseTime(e.target.value),start=field==='start'?value:t.start,end=field==='end'?value:t.end;if(!Number.isFinite(value)||start<0||end-start<3||(t.duration&&end>t.duration)){e.target.value=formatTime(t[field]);throw new Error('Use m:ss or seconds, and choose at least three seconds within the song.');}t[field]=value;}invalidate();display();await save();status('Songs updated.');});};
$('tracks').onclick=e=>{const btn=e.target.closest('[data-act]');if(!btn)return;action(async()=>{const id=btn.closest('[data-id]').dataset.id,index=project.tracks.findIndex(x=>x.id===id),t=project.tracks[index],act=btn.dataset.act;let remove=null;if(act==='remove'){project.tracks.splice(index,1);buffers.delete(id);remove=id;delete project.tempoChoices[id];for(const key of Object.keys(project.choices))if(key.split(':').includes(id))delete project.choices[key];}else if(act==='up'&&index>0)[project.tracks[index-1],project.tracks[index]]=[t,project.tracks[index-1]];else if(act==='down'&&index<project.tracks.length-1)[project.tracks[index+1],project.tracks[index]]=[t,project.tracks[index+1]];else if(act==='slower')t.pace=.5;else if(act==='faster')t.pace=2;else if(act==='reset')t.pace=1;invalidate();display();await save(null,null,remove);status('Songs updated.');});};
$('flex').oninput=()=>{project.flex=Number($('flex').value);flexText();invalidate();};$('flex').onchange=()=>action(async()=>{display();await save();status('Mixing freedom updated.');});
function payloadFor(plan,index=null){let clips=plan.clips;if(index!==null){clips=clips.slice(index,index+2).map(c=>({...c}));const overlap=clips[0].overlap;clips[0].start=Math.max(clips[0].start,clips[0].end-(8+overlap*4)*clips[0].rate);clips[1].end=Math.min(clips[1].end,clips[1].start+(8+overlap*4)*clips[1].rate);clips[1].overlap=0;}return {sampleRate:SR,clips:clips.map(c=>{const b=buffers.get(c.id),full=plan.clips.find(x=>x.id===c.id);let sum=0,n=0;for(let j=Math.round(full.start*SR);j<Math.min(b.length,Math.round(full.end*SR));j+=8)for(let ch=0;ch<Math.min(2,b.numberOfChannels);ch++){sum+=b.getChannelData(ch)[j]**2;n++;}const rms=Math.sqrt(sum/Math.max(1,n));return {...c,gain:rms>.0001?clamp(.15/rms,.25,2.5):1,channels:Array.from({length:Math.min(2,b.numberOfChannels)},(_,i)=>b.getChannelData(i).slice(Math.round(c.start*SR),Math.round(c.end*SR)))};})};}
$('transitions').onclick=e=>{const btn=e.target.closest('button');if(!btn)return;action(async()=>{
  if('tempoPick'in btn.dataset){const i=Number(btn.dataset.tempoPick),id=project.tracks[i].id,previous=project.tempoChoices[id];project.tempoChoices[id]=btn.dataset.value;
    try{await renderMix();}catch(error){project.tempoChoices[id]=previous;throw error;}await save();return;
  }
  if('tempoPreview'in btn.dataset){const i=Number(btn.dataset.tempoPreview),id=project.tracks[i].id,plan=planMix(project.tracks,project.flex,project.choices,{...project.tempoChoices,[id]:btn.dataset.value});await previewPlan(plan,i-1);return;}
  const i=Number(btn.dataset.preview??btn.dataset.pick),a=project.tracks[i],b=project.tracks[i+1],key=`${a.id}:${b.id}`,style=btn.dataset.style;
  if('pick'in btn.dataset){const previous=project.choices[key];project.choices[key]=style;try{await renderMix();}catch(error){project.choices[key]=previous;throw error;}await save();return;}
  const plan=planMix(project.tracks,project.flex,{...project.choices,[key]:style},project.tempoChoices);await previewPlan(plan,i);
});};
$('render').onclick=()=>action(async()=>{closeChoice();await renderMix({focus:true});});
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
$('wav').onclick=()=>{if(wav)download(new Blob([wav],{type:'audio/wav'}),'mix-moni.wav');};$('mp3').onclick=()=>action(async()=>{if(!wav)return;status('Encoding MP3…');const bytes=await run('mp3',{wav,sampleRate:SR},p=>status(`Encoding MP3… ${Math.round(p*100)}%`));download(new Blob([bytes],{type:'audio/mpeg'}),'mix-moni.mp3');status('MP3 downloaded.');});
$('demo').onclick=()=>action(async()=>{if(project.tracks.length){status('Try the demo in an empty lineup, so your songs stay safe.');return;}const names=['Neon arrival','Afterglow'];for(let k=0;k<2;k++){const seconds=32,b=ctx().createBuffer(2,seconds*SR,SR),tempo=k?124:120;for(let i=0;i<b.length;i++){const t=i/SR,beat=t*tempo/60,phase=beat%1,section=t<8?.4:t<16?.7:1,kick=Math.sin(2*Math.PI*(52*t+1.3*(1-Math.exp(-phase*20))))*Math.exp(-phase*20)*.55,hat=Math.sin(i*42.719)*Math.cos(i*12.173)*Math.exp(-(beat*2%1)*45)*.045,bass=Math.sin(2*Math.PI*(k?110:98)*t)*.05,melody=Math.sin(2*Math.PI*[293.66,349.23,440,523.25][Math.floor(beat/2)%4]*t)*.06,s=(kick+hat+bass+melody)*section*Math.min(1,t*3,(seconds-t)*3);b.getChannelData(0)[i]=s;b.getChannelData(1)[i]=s*.96;}const t=newTrack(names[k]);project.tracks.push(t);await attach(t,new File([wavBytes([b.getChannelData(0),b.getChannelData(1)],SR)],names[k]+'.wav',{type:'audio/wav'}));t.start=k?16:0;t.end=k?32:16;await save();}invalidate();display();status('Two original demo loops are ready. Click Create mix to see the result.');});
async function init(){setBusy(true);try{db=await openDb();const saved=await get('project','current');if(saved&&Array.isArray(saved.tracks)){project=saved;project.flex=Number.isFinite(saved.flex)?saved.flex:50;project.choices=saved.choices||{};project.tempoChoices=saved.tempoChoices||{};for(const t of project.tracks){const f=await get('audio',t.id);if(!f)continue;if(t.url&&!t.youtubeTitle&&!t.nameEdited&&t.name===f.name?.replace(/\.[^.]+$/,''))t.name='YouTube song';status(`Restoring ${t.name}…`);try{buffers.set(t.id,await ctx().decodeAudioData(await f.arrayBuffer()));}catch{t.analysis=null;}}}status(project.tracks.some(t=>!buffers.has(t.id))?'Some audio is missing. Reattach it to continue.':project.tracks.length?'Your lineup is restored.':'Ready when you are.');}catch{status('Browser storage is unavailable. You can mix this session, but it won’t be saved.',true);document.querySelector('.local').textContent='Session only';}finally{display();setBusy(false);for(const t of project.tracks)if(t.url&&!t.youtubeTitle&&!t.nameEdited&&(t.name==='YouTube song'||t.name.startsWith('YouTube · ')))void resolveTrackTitle(t);}}
init();

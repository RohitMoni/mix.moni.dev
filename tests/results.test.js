import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mixLayout,waveformPeaks} from '../results.js';
import {renderPrepared,wavBytes} from '../engine.js';
test('timeline locations match rendered audio and transition overlap centers',()=>{
 const sr=22050,plan={clips:[{id:'a',start:0,end:10,rate:1,overlap:2},{id:'b',start:3,end:13,rate:1.05,overlap:0}]},map=mixLayout(plan,sr);
 const payload=plan.clips.map(c=>({...c,channels:[new Float32Array(Math.round(c.end*sr)-Math.round(c.start*sr))]}));
 const rendered=renderPrepared(payload,sr);
 assert.equal(map.duration,rendered[0].length/sr);assert.equal(map.sections[0].transitionTime,9);assert.equal(map.sections[1].startTime,8);assert.equal(map.sections[0].id,'a');assert.notEqual(map.sections[0].color,map.sections[1].color);
});
test('simplified waveform represents real PCM amplitude rather than decorative randomness',()=>{
 const data=Float32Array.from({length:1000},(_,i)=>i<500?0:.5),wav=wavBytes([data,data],44100),peaks=waveformPeaks(wav,10);
 assert.ok([...peaks.slice(0,5)].every(x=>x===0));assert.ok([...peaks.slice(5)].every(x=>Math.abs(x-.5)<.001));
});

test('short excerpts cap overlaps in the timeline exactly as in the renderer',()=>{const map=mixLayout({clips:[{id:'a',start:0,end:10,rate:1,overlap:3},{id:'b',start:0,end:4,rate:1,overlap:0}]});assert.equal(map.sections[0].transitionTime,9.5);assert.equal(map.sections[1].startTime,9);assert.equal(map.duration,13);});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchYoutubeTitle} from '../youtube.js';
const url='https://youtu.be/dQw4w9WgXcQ';
test('retrieves the actual video title without credentials',async()=>{
 let request;
 const title=await fetchYoutubeTitle(url,{fetcher:async(endpoint,options)=>{request={endpoint,options};return {ok:true,json:async()=>({title:'  Rick Astley - Never Gonna Give You Up  '})};}});
 assert.equal(title,'Rick Astley - Never Gonna Give You Up');assert.ok(request.endpoint.startsWith('https://www.youtube.com/oembed?'));assert.equal(new URL(request.endpoint).searchParams.get('url'),'https://www.youtube.com/watch?v=dQw4w9WgXcQ');assert.equal(request.options.credentials,'omit');
});
test('falls back to metadata provider when YouTube is blocked',async()=>{
 const endpoints=[];
 const title=await fetchYoutubeTitle(url,{fetcher:async endpoint=>{endpoints.push(endpoint);if(endpoints.length===1)throw new TypeError('Failed to fetch');return {ok:true,json:async()=>({title:'Artist — Song'})};}});
 assert.equal(title,'Artist — Song');assert.equal(endpoints.length,2);assert.ok(endpoints[1].startsWith('https://noembed.com/embed?'));
});
test('provider errors and missing titles are rejected for a usable fallback name',async()=>{
 await assert.rejects(()=>fetchYoutubeTitle(url,{fetcher:async()=>({ok:true,json:async()=>({error:'Not found',title:'ignored'})})}),/Could not retrieve/);
 await assert.rejects(()=>fetchYoutubeTitle(url,{fetcher:async()=>({ok:false})}),/Could not retrieve/);
});
test('metadata requests time out instead of blocking song imports',async()=>{
 let attempts=0;
 await assert.rejects(()=>fetchYoutubeTitle(url,{timeoutMs:5,fetcher:()=>{attempts++;return new Promise(()=>{});}}),/Could not retrieve/);assert.equal(attempts,2);
});
test('rejects non-YouTube input without sending it to a provider',async()=>{
 let called=false;await assert.rejects(()=>fetchYoutubeTitle('https://example.com',{fetcher:async()=>{called=true;}}),/Invalid/);assert.equal(called,false);
});

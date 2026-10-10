import {youtubeUrl} from './engine.js';

// Metadata only: no API key, playback embed, or audio download.
export async function fetchYoutubeTitle(input,{fetcher=globalThis.fetch,timeoutMs=4500}={}) {
  const url=youtubeUrl(input);
  if(!url)throw new Error('Invalid YouTube video URL.');
  const endpoints=[
    `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
    `https://noembed.com/embed?url=${encodeURIComponent(url)}`
  ];
  for(const endpoint of endpoints){
    const controller=new AbortController();
    let timer;
    try {
      // Also bound providers which fail to honor cancellation.
      const result=await Promise.race([
        (async()=>{
          const response=await fetcher(endpoint,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
          if(!response.ok)throw new Error('Metadata unavailable.');
          const data=await response.json();
          if(data.error||typeof data.title!=='string'||!data.title.trim())throw new Error('Missing title.');
          return data.title.trim().slice(0,300);
        })(),
        new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Metadata timed out.'));},timeoutMs);})
      ]);
      return result;
    }catch{/* Try the metadata-only fallback; importing is never blocked. */}
    finally{clearTimeout(timer);}
  }
  throw new Error('Could not retrieve this video’s title.');
}

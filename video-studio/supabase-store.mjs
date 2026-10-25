// Separate video-only Supabase control plane. Service-role key stays on the worker.
import {createHash} from 'node:crypto';
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
export function createVideoStore({url, serviceKey, bucket='video-studio', fetchImpl=fetch}={}) {
  if (!/^https:\/\//.test(url||'') || !serviceKey || serviceKey.length<24)
    throw new Error('VIDEO_STUDIO_STORE: SUPABASE_URL e SERVICE_ROLE_KEY necessari solo al worker');
  if (!/^[a-z0-9-]{3,40}$/.test(bucket)) throw new Error('VIDEO_STUDIO_STORE: bucket non valido');
  const root=url.replace(/\/+$/,'');
  async function request(path,{method='GET',body,headers={},binary=false}={}) {
    const response=await fetchImpl(`${root}${path}`,{
      method,headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,...headers},body,cache:'no-store'
    });
    if(!response.ok) {
      const msg=(await response.text().catch(()=>'' )).slice(0,600);
      throw new Error(`VIDEO_STUDIO_STORE: HTTP ${response.status}: ${msg}`);
    }
    if(binary) return Buffer.from(await response.arrayBuffer());
    if(response.status===204)return null;
    const text=await response.text();return text?JSON.parse(text):null;
  }
  async function rest(path,{method='GET',data,filter='',prefer}={}) {
    return request(`/rest/v1/${path}${filter}`,{
      method,
      headers:{'Content-Type':'application/json',Prefer:prefer||'return=representation'},
      body:data===undefined?undefined:JSON.stringify(data)
    });
  }
  function id(value) {if(!UUID.test(value||''))throw new Error('VIDEO_STUDIO_STORE: ID UUID non valido');return value;}
  function mediaPath(path) {
    if (typeof path!=='string' || !/^[a-f0-9-]{36}\/(scenes\/scene_[1-4]\.png|music\/preview\.m4a|master\/reel\.mp4|master\/mobile-review\.jpg)$/.test(path))
      throw new Error('VIDEO_STUDIO_STORE: percorso asset privato non valido');
    id(path.split('/')[0]);return path;
  }
  return {
    async pending() {return rest('video_studio_projects',{filter:'?select=*&state=in.(queued,render_queued)&order=created_at.asc&limit=10'});},
    async reapStale() {
      const now=new Date().toISOString();
      const stale=await rest('video_studio_projects',{filter:`?select=id,state,lease_key,attempts&state=in.(preparing,rendering)&lease_until=lt.${encodeURIComponent(now)}&limit=10`});
      for(const p of stale||[]) if(UUID.test(p.lease_key||'')) {
        await rest('video_studio_projects',{method:'PATCH',filter:`?id=eq.${id(p.id)}&state=eq.${p.state}&lease_key=eq.${id(p.lease_key)}&select=id`,data:{state:'failed',lease_key:null,lease_until:null,last_error:'Worker lease scaduta: retry solo dopo verifica',attempts:Math.min(5,(p.attempts||0)+1)}});
      }
      return stale?.length||0;
    },
    async get(projectId) {const rows=await rest('video_studio_projects',{filter:`?select=*&id=eq.${id(projectId)}&limit=1`});return rows?.[0]||null;},
    async claim(projectId, from, to, key) {
      const allowed={queued:'preparing',render_queued:'rendering'};
      if(allowed[from]!==to || !UUID.test(key))throw new Error('VIDEO_STUDIO_STORE: claim non valido');
      const data={state:to,lease_key:key,lease_until:new Date(Date.now()+20*60*1000).toISOString(),last_error:null};
      const rows=await rest('video_studio_projects',{method:'PATCH',filter:`?id=eq.${id(projectId)}&state=eq.${from}&lease_key=is.null&select=*`,data});
      return rows?.length===1?rows[0]:null;
    },
    async heartbeat(projectId,leaseKey) {
      const rows=await rest('video_studio_projects',{method:'PATCH',filter:`?id=eq.${id(projectId)}&lease_key=eq.${id(leaseKey)}&select=id`,
        data:{lease_until:new Date(Date.now()+20*60*1000).toISOString()}});
      if(rows?.length!==1)throw new Error('VIDEO_STUDIO_STORE: heartbeat senza lease');
    },
    async finish(projectId,leaseKey,data) {
      const rows=await rest('video_studio_projects',{method:'PATCH',filter:`?id=eq.${id(projectId)}&lease_key=eq.${id(leaseKey)}&select=*`,data:{...data,lease_key:null,lease_until:null}});
      if(rows?.length!==1)throw new Error('VIDEO_STUDIO_STORE: lease scaduto o modificato');return rows[0];
    },
    async event(projectId,type,details={}) {
      return rest('video_studio_events',{method:'POST',data:{project_id:id(projectId),type:String(type).slice(0,80),details}});
    },
    async upload(path,bytes,contentType) {
      mediaPath(path);
      if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>100*1024*1024)throw new Error('VIDEO_STUDIO_STORE: dimensione asset non valida');
      try {return await request(`/storage/v1/object/${bucket}/${path}`,{method:'POST',headers:{'Content-Type':contentType,'x-upsert':'false'},body:bytes});}
      catch(error) {
        if(!/HTTP 409/.test(String(error)))throw error;
        const previous=await request(`/storage/v1/object/${bucket}/${path}`,{binary:true});
        const sha=b=>createHash('sha256').update(b).digest('hex');
        if(sha(previous)!==sha(bytes))throw new Error('VIDEO_STUDIO_STORE: conflitto idempotenza asset');
        return {reused:true};
      }
    },
    async download(path) {mediaPath(path);return request(`/storage/v1/object/${bucket}/${path}`,{binary:true});}
  };
}

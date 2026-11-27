import crypto from 'node:crypto';
// This token is scoped exclusively to no-archive Staff previews, never to Staff APIs.
const scope = 'ol-staff-preview-no-archive-v1';
const ttl = 8 * 60 * 60 * 1000;
function secret() { return [process.env.STAFF_PREVIEW_TOKEN,process.env.LEAD_SESSION_SECRET,process.env.CUSTOMER_DB_HASH_SECRET,process.env.OTP_SECRET].map(x=>String(x||'').trim()).find(x=>Buffer.byteLength(x)>=32)||''; }
function sign(body,key) { return crypto.createHmac('sha256',key).update(scope+'.'+body).digest('base64url'); }
export function issueStaffPreviewProof(now=Date.now()) { const key=secret(); if(!key)return ''; const body=Buffer.from(JSON.stringify({exp:now+ttl,nonce:crypto.randomBytes(18).toString('base64url')})).toString('base64url');return body+'.'+sign(body,key); }
export function staffPreviewProofStatus(req,now=Date.now()) { const value=String(req.headers?.['x-ol-staff-preview']||'').trim();if(!value)return 'absent';const key=secret();if(!key||value.length>512)return 'invalid';const parts=value.split('.');if(parts.length!==2)return 'invalid';try{const [body,sig]=parts;const a=Buffer.from(sig),b=Buffer.from(sign(body,key));if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return 'invalid';const p=JSON.parse(Buffer.from(body,'base64url').toString());return Number.isSafeInteger(p.exp)&&p.exp>now&&p.exp<=now+ttl&&typeof p.nonce==='string'&&p.nonce.length>=16?'verified':'invalid';}catch{return 'invalid';} }

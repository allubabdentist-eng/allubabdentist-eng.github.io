'use strict';
/* Sama Allubab stock app: encrypted remote update, orders and audit always stay on this device. */
const SAMA_SYNC={
 name:'stock-latest.json',
 remember:'sama_allubab_debt_unlock_web_v1',
 aad:'sama-allubab-inventory-v1',
 keyId:'stock-cloud-bridge-v1'
};
let _samaSyncBusy=false;
const _samaBytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function _samaGzip(x){
 const stream=new Blob([x]).stream().pipeThrough(new DecompressionStream('gzip'));
 return new Uint8Array(await new Response(stream).arrayBuffer());
}
function _samaBtn(){
 let btn=document.getElementById('samaCloudSync');
 if(btn)return btn;
 const place=document.querySelector('.hero-action')||document.querySelector('.hero');
 btn=document.createElement('button');
 btn.id='samaCloudSync';
 btn.type='button';
 btn.className='main-upload';
 btn.textContent='↻ تحديث المخزون من التطبيق';
 btn.title='تحديث الجرد المنشور بدون حذف قوائم الطلبيات أو الجرد السابق';
 if(place)place.appendChild(btn);
 btn.addEventListener('click',()=>syncStockRemote(true));
 const note=document.createElement('small');
 note.id='samaCloudStatus';
 note.style.cssText='display:block;max-width:290px;line-height:1.5;color:#075d68;font-size:12px;text-align:center';
 note.textContent='الربط المباشر آمن. أول مرة فقط أدخل رمز الدخول، ثم يتحدث الجرد عند فتح التطبيق.';
 if(place)place.appendChild(note);
 return btn;
}
function _samaStatus(msg){
 const el=document.getElementById('samaCloudStatus');if(el)el.textContent=msg;
}
async function _samaReadSavedKey(){
 try{
  const d=await db();
  return await new Promise(resolve=>{
   const req=d.transaction('data','readonly').objectStore('data').get(SAMA_SYNC.keyId);
   req.onsuccess=()=>resolve(req.result?.key||null);
   req.onerror=()=>resolve(null);
  });
 }catch(e){return null;}
}
async function _samaSaveKey(key){
 try{
  const d=await db();
  return await new Promise(resolve=>{
   const tx=d.transaction('data','readwrite');
   tx.objectStore('data').put({key,savedAt:new Date().toISOString()},SAMA_SYNC.keyId);
   tx.oncomplete=()=>resolve(true);
   tx.onerror=()=>resolve(false);
   tx.onabort=()=>resolve(false);
  });
 }catch(e){return false;}
}
async function _samaKeyFromPass(pass){
 const resp=await fetch('../auth.json?t='+Date.now(),{cache:'no-store'});
 if(!resp.ok)throw Error('تعذر قراءة ملف التحقق');
 const auth=await resp.json(),p=auth.payload;
 const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey']);
 const secret=await crypto.subtle.deriveKey(
  {name:'PBKDF2',salt:_samaBytes(p.salt),iterations:p.iterations,hash:'SHA-256'},
  base,{name:'AES-GCM',length:256},false,['decrypt']);
 const plain=await crypto.subtle.decrypt(
  {name:'AES-GCM',iv:_samaBytes(p.nonce),additionalData:new TextEncoder().encode('sama-allubab-debts-v2-gzip')},
  secret,_samaBytes(p.cipher));
 const rows=JSON.parse(new TextDecoder().decode(await _samaGzip(new Uint8Array(plain))));
 const anchor=rows.find(r=>String(r.name||'').trim()==='شركة الضمان'&&String(r.phone||'').trim()==='07710234436');
 if(!anchor)throw Error('حساب التحقق غير موجود');
 const m=String(anchor.amount||'').match(/-?[\d,]+(?:\.\d+)?/);
 const balance=m?String(Math.round(Number(m[0].replace(/,/g,'')))):String(anchor.amount||'').trim();
 const seed=String(anchor.name).trim()+'|'+String(anchor.phone).trim()+'|'+balance;
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(seed));
 // Stored as a non-extractable CryptoKey; never store this app's plain-text PIN.
 return crypto.subtle.importKey('raw',digest,{name:'AES-GCM'},false,['decrypt']);
}
async function _samaFetchStock(){
 const r=await fetch(SAMA_SYNC.name+'?t='+Date.now(),{cache:'no-store'});
 if(!r.ok)throw Error('تعذر جلب آخر جرد');
 const latest=await r.json();
 if(!latest||!latest.payload?.cipher||!latest.version||!latest.count)throw Error('ملف الجرد غير مكتمل');
 return latest;
}
async function _samaDecrypt(latest,key){
 const variants=[latest.payload,...Object.values(latest.payload_candidates||{})];
 for(const p of variants){
  try{
   const bytes=await crypto.subtle.decrypt(
    {name:'AES-GCM',iv:_samaBytes(p.nonce),additionalData:new TextEncoder().encode(SAMA_SYNC.aad)},
    key,_samaBytes(p.cipher));
   const data=JSON.parse(new TextDecoder().decode(await _samaGzip(new Uint8Array(bytes))));
   if(!Array.isArray(data.products)||data.products.length!==Number(latest.count))throw Error('عدد المواد غير مطابق');
   return data;
  }catch(e){/* The candidate may have been encrypted with another authorized balance. */}
 }
 throw Error('تعذر فك ملف الجرد بهذا الرمز');
}
async function syncStockRemote(interactive=false){
 if(_samaSyncBusy)return false;
 _samaSyncBusy=true;
 const btn=_samaBtn();
 btn.disabled=true;btn.textContent='جارِ فحص التحديث...';
 try{
  let key=await _samaReadSavedKey();
  let pass='';
  if(!key){try{pass=localStorage.getItem(SAMA_SYNC.remember)||'';}catch(e){}}
  if(!key&&!pass&&interactive)pass=prompt('لربط تحديث المخزون على نفس التطبيق، أدخل رمز دخول الديون مرة واحدة:', '')||'';
  if(!key&&!pass){
   btn.textContent='🔒 ربط التحديث المباشر';
   _samaStatus('أول مرة: اضغط ربط التحديث وأدخل رمز الدخول. بعدها الجرد يتحدث بنفس الأيقونة.');
   return false;
  }
  const latest=await _samaFetchStock();
  let raw;
  if(key){try{raw=await _samaDecrypt(latest,key)}catch(e){key=null;}}
  if(!raw&&pass){
   key=await _samaKeyFromPass(pass);
   raw=await _samaDecrypt(latest,key);
   await _samaSaveKey(key);
  }
  if(!raw&&interactive){
   const entered=prompt('رمز الربط السابق تغيّر. أدخل رمز الدخول الحالي لتجديد التحديث:', '')||'';
   if(!entered)throw Error('تم إلغاء الربط');
   key=await _samaKeyFromPass(entered);
   raw=await _samaDecrypt(latest,key);
   await _samaSaveKey(key);
  }
  if(!raw)throw Error('مفتاح ربط المخزون غير صالح');
  const snapshot=normalizeSnapshot(raw),first=state.snapshots[0];
  if(first&&String(first.date)>String(snapshot.date)){
   btn.textContent='✓ الجرد المحلي أحدث';
   _samaStatus('الجرد الموجود على هذا الآيفون أحدث من المنشور. ما تم استبداله.');
   return false;
  }
  if(!first||first.key!==snapshot.key){
   const at=state.snapshots.findIndex(s=>s.key===snapshot.key);
   const previous=state.snapshots.slice();
   if(at>=0)state.snapshots.splice(at,1);
   state.snapshots.unshift(snapshot);state.snapshots=state.snapshots.slice(0,16);
   try{await storageWrite()}catch(e){state.snapshots=previous;throw e;}
   state.shown=80;refresh();
  }
  const now=new Intl.DateTimeFormat('ar-IQ',{timeZone:'Asia/Baghdad',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:true}).format(new Date());
  const source=String(latest.updated_at||snapshot.date||'');
  btn.textContent='✓ المخزون محدّث';
  _samaStatus('آخر جرد منشور: '+source+' (بغداد) • فُحص على جهازك: '+now);
  if(interactive)alertBox('✓ المخزون محدث بنفس التطبيق، وقوائم الطلبيات والجرد السابق محفوظة.');
  return true;
 }catch(err){
  console.warn('Sama inventory sync:',err);
  btn.textContent='↻ إعادة تحديث المخزون';
  _samaStatus('لم يكتمل جلب التحديث؛ بياناتك وطلبياتك السابقة محفوظة.');
  if(interactive)alertBox('تعذر تحديث المخزون. تأكد من الإنترنت ورمز الدخول ثم حاول مرة ثانية.','error');
  return false;
 }finally{btn.disabled=false;_samaSyncBusy=false;}
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&document.readyState==='complete')syncStockRemote(false)});

'use strict';
/* Remote inventory sync: decrypt only in the browser, preserve local orders & audits. */
const SAMA_SYNC={name:'seed-20261025.json',remember:'sama_allubab_debt_unlock_web_v1',aad:'sama-allubab-inventory-v1'};
const _samaBytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function _samaGzip(x){const stream=new Blob([x]).stream().pipeThrough(new DecompressionStream('gzip'));return new Uint8Array(await new Response(stream).arrayBuffer())}
async function _samaCloud(pass){
 const [a,b]=await Promise.all([
  fetch('../auth.json?nocache='+Date.now(),{cache:'no-store'}),
  fetch(SAMA_SYNC.name+'?nocache='+Date.now(),{cache:'no-store'})
 ]);
 if(!a.ok||!b.ok)throw Error('تعذر الاتصال بالتحديث المنشور');
 const auth=await a.json(),remote=await b.json(),p=auth.payload;
 const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey']);
 const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:_samaBytes(p.salt),iterations:p.iterations,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['decrypt']);
 const dec=await crypto.subtle.decrypt({name:'AES-GCM',iv:_samaBytes(p.nonce),additionalData:new TextEncoder().encode('sama-allubab-debts-v2-gzip')},key,_samaBytes(p.cipher));
 const rows=JSON.parse(new TextDecoder().decode(await _samaGzip(new Uint8Array(dec))));
 const anchor=rows.find(r=>String(r.name||'').trim()==='شركة الضمان'&&String(r.phone||'').trim()==='07710234436');
 if(!anchor)throw Error('المفتاح الموثّق للمكتب غير متوفر');
 const m=String(anchor.amount||'').match(/-?[\d,]+(?:\.\d+)?/);
 const balance=m?String(Math.round(Number(m[0].replace(/,/g,'')))):String(anchor.amount||'').trim();
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(anchor.name).trim()+'|'+String(anchor.phone).trim()+'|'+balance));
 const bridge=await crypto.subtle.importKey('raw',digest,{name:'AES-GCM'},false,['decrypt']);
 const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:_samaBytes(remote.payload.nonce),additionalData:new TextEncoder().encode(SAMA_SYNC.aad)},bridge,_samaBytes(remote.payload.cipher));
 return JSON.parse(new TextDecoder().decode(await _samaGzip(new Uint8Array(raw))));
}
function addSamaSyncButton(){
 let btn=document.getElementById('samaCloudSync');
 if(btn)return btn;
 btn=document.createElement('button');btn.id='samaCloudSync';btn.type='button';btn.className='main-upload';btn.textContent='↻ تحديث الجرد المنشور';btn.title='تحديث المواد بدون مسح قوائم الطلبيات';
 const spot=document.querySelector('.hero-action')||document.querySelector('.hero');
 if(spot)spot.appendChild(btn);
 btn.addEventListener('click',()=>syncStockRemote(true));
 return btn;
}
async function syncStockRemote(interactive=false){
 const btn=addSamaSyncButton();let pass='';
 try{pass=localStorage.getItem(SAMA_SYNC.remember)||'';}catch(e){}
 if(!pass&&interactive)pass=prompt('رمز دخول تطبيق ديون سما اللباب — يستخدم محلياً فقط لفك التحديث:', '')||'';
 if(!pass){btn.textContent='🔒 تحديث الجرد المنشور';return false;}
 const oldText=btn.textContent;btn.disabled=true;btn.textContent='جارِ فحص الجرد...';
 try{
  const raw=await _samaCloud(pass),snapshot=normalizeSnapshot(raw),first=state.snapshots[0];
  if(first&&first.date>snapshot.date){btn.textContent='الجرد المحلي أحدث';return false;}
  if(!state.snapshots.some(s=>s.key===snapshot.key)){
   state.snapshots.unshift(snapshot);state.snapshots=state.snapshots.slice(0,16);
   await storageWrite();state.shown=80;refresh();
   alertBox('تم تحديث مخزن المواد تلقائياً من الملف المعتمد بتاريخ '+snapshot.date+' بدون مسح الطلبيات أو الجرد السابق.');
  }
  if(interactive){try{localStorage.setItem(SAMA_SYNC.remember,pass)}catch(e){}}
  btn.textContent='✓ الجرد محدث';return true;
 }catch(err){
  console.warn('Sama inventory sync',err);
  btn.textContent='↻ إعادة تحديث الجرد';
  if(interactive)alertBox('ما تم تحديث المخزن. تأكد من رمز الدخول والإنترنت؛ بياناتك القديمة باقية محفوظة.','error');
  return false;
 }finally{btn.disabled=false;}
}

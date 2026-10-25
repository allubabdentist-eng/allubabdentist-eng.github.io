'use strict';
/* Sama Allubab stock control — all company data stays on the device. */
const $ = id => document.getElementById(id);
const nf = new Intl.NumberFormat('en-US',{maximumFractionDigits:3});
const state = {snapshots:[],audits:[],groups:[],groupMap:new Map(),deltaMap:new Map(),deltas:[],pageSize:80,shown:80,activeTab:'inventory',activeAuditName:null,low:10,orderItems:[],orderCustomer:'',orderCustomerPhone:'',orderGeneralNote:'',savedOrders:[],editingOrderId:null,orderSelectedKey:null};
const dbName = 'SamaAllubabPrivateInventoryV1';
let dbPromise;
function db(){
  if(!dbPromise) dbPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open(dbName,1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('data'))req.result.createObjectStore('data')};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
  return dbPromise;
}
async function storageRead(){const d=await db();return new Promise((res,rej)=>{const q=d.transaction('data','readonly').objectStore('data').get('inventory');q.onsuccess=()=>res(q.result||null);q.onerror=()=>rej(q.error)})}
async function storageWrite(){const d=await db();const data={snapshots:state.snapshots,audits:state.audits,orderItems:state.orderItems,orderCustomer:state.orderCustomer,orderCustomerPhone:state.orderCustomerPhone,orderGeneralNote:state.orderGeneralNote,savedOrders:state.savedOrders};return new Promise((res,rej)=>{const tx=d.transaction('data','readwrite');tx.objectStore('data').put(data,'inventory');tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}
function cleanName(v){return String(v||'').trim().replace(/\s+/g,' ')}
function nameKey(v){return cleanName(v).toLocaleLowerCase()}
function compactNameKey(v){return nameKey(v).normalize('NFKD').replace(/[\u064b-\u065f\u0670]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/[^a-z0-9\u0621-\u064a]/gi,'')}
function lookupStock(name,key=null){
  const direct=key&&state.groupMap.get(key);
  if(direct)return direct;
  const byName=state.groupMap.get(nameKey(name));
  if(byName)return byName;
  const compact=compactNameKey(name);
  if(!compact)return null;
  const matches=state.groups.filter(g=>compactNameKey(g.name)===compact);
  return matches.length===1?matches[0]:null;
}
function orderStockCaption(item){
  if(!state.snapshots.length)return 'رصيد المخزن غير محمّل على هذا الجهاز';
  const g=lookupStock(item.name,item.key);
  return g?'المتوفر بالمخزن: '+fmtn(g.quantity)+' قطعة':'غير موجود ضمن أسماء الجرد الحالي — راجع الاسم';
}
function renderOrderStockStatus(){
  const el=$('orderStockInfo');if(!el)return;
  const loaded=Boolean(state.snapshots.length);
  el.classList.toggle('missing',!loaded);
  el.textContent=loaded?'✅ كميات المخزن من الجرد المعتمد ('+fmtn(state.groups.length)+' صنف). ابحث عن مادة وشوف رصيدها قبل إضافتها.':'⚠️ ماكو جرد محمّل على هذا الآيفون. اضغط «تحديث الجرد» واستورد mat.xls حتى تظهر أعداد المواد الصحيحة.';
}
function parseNumber(v){if(typeof v==='number')return v;const n=Number(String(v??0).replace(/,/g,'').trim());return Number.isFinite(n)?n:0}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function fmtn(v){return nf.format(v)}
function alertBox(text,kind='ok'){$('alert').hidden=false;$('alert').className='alert '+(kind==='error'?'error':'');$('alert').textContent=text;window.scrollTo({top:0,behavior:'smooth'})}
function toISODate(v){return /^\d{4}-\d\d-\d\d$/.test(String(v||''))?v:new Date().toLocaleDateString('en-CA')}
function snapshotFingerprint(products){let hash=2166136261;for(const p of products){const s=nameKey(p.name)+'|'+String(p.quantity)+';';for(let i=0;i<s.length;i++){hash^=s.charCodeAt(i);hash=Math.imul(hash,16777619)}}return (hash>>>0).toString(16)+'-'+products.length}
function normalizeSnapshot(raw){
  if(!raw||!Array.isArray(raw.products)||!raw.products.length)throw new Error('الملف لا يحتوي على قائمة مواد صالحة.');
  const products=raw.products.map((p,i)=>({line:parseNumber(p.line)||i+1,name:cleanName(p.name),quantity:parseNumber(p.quantity),wholesale:String(p.wholesale??''),sale:String(p.sale??''),lastPurchase:String(p.lastPurchase??''),purchase:String(p.purchase??'')})).filter(p=>p.name);
  if(!products.length)throw new Error('أسماء المواد غير موجودة.');
  const signature=snapshotFingerprint(products);
  return {key:signature,date:toISODate(raw.date),filename:raw.filename||'جرد مرفوع',created:new Date().toISOString(),products};
}
function grouped(products){const m=new Map();for(const p of products){const k=nameKey(p.name);if(!m.has(k))m.set(k,{key:k,name:p.name,quantity:0,lines:[],count:0});const g=m.get(k);g.quantity+=parseNumber(p.quantity);g.count++;g.lines.push(p)}return m}
function buildChanges(){
  const now=state.snapshots[0],prev=state.snapshots[1];state.deltaMap=new Map();state.deltas=[];
  if(!now||!prev)return;
  const a=grouped(now.products),b=grouped(prev.products);
  for(const k of new Set([...a.keys(),...b.keys()])){
    const cur=a.get(k),old=b.get(k),before=old?old.quantity:0,after=cur?cur.quantity:0,delta=after-before;
    if(delta!==0||!cur||!old){const row={key:k,name:cur?.name||old?.name,before,after,delta,kind:!old?'new':!cur?'gone':delta>0?'up':'down'};state.deltas.push(row);state.deltaMap.set(k,row)}
  }
  state.deltas.sort((x,y)=>Math.abs(y.delta)-Math.abs(x.delta));
}
function refresh(){
  const latest=state.snapshots[0];state.groupMap=latest?grouped(latest.products):new Map();state.groups=[...state.groupMap.values()].sort((a,b)=>a.name.localeCompare(b.name,'ar'));
  buildChanges();
  $('currentDateLabel').textContent=latest?'آخر جرد: '+latest.date+' — '+latest.filename:'ارفع الجرد المعتمد حتى نعرض حالة المواد';
  const raw=latest?.products||[];
  $('statLines').textContent=raw.length?fmtn(raw.length):'—';
  $('statAvailable').textContent=latest?fmtn(state.groups.filter(g=>g.quantity>0).length):'—';
  $('statOut').textContent=latest?fmtn(state.groups.filter(g=>g.quantity===0).length):'—';
  $('statNegative').textContent=latest?fmtn(state.groups.filter(g=>g.quantity<0).length):'—';
  $('uniqueCount').textContent=fmtn(state.groups.length)+' صنف';
  renderInventory();renderChanges();renderAudits();renderSnapshots();renderOrderStockStatus();renderOrder();renderOrderSuggestions();renderSavedOrders();
}
function productCard(g){const klass=g.quantity<0?'red':g.quantity===0?'orange':'';const details=g.count>1?g.count+' أسطر بنفس الاسم':`تسلسل ${g.lines[0].line}`;return `<article class="product-card"><div><div class="product-title">${esc(g.name)}</div><div class="product-sub">${esc(details)}</div></div><div><span class="quantity ${klass}">${fmtn(g.quantity)}</span><span class="qtylabel">الكمية</span></div><div class="product-actions"><span class="subtle">${g.quantity<0?'رصيد سالب — راجع الإدخالات':g.quantity===0?'غير متوفر':g.quantity<=state.low?'كمية قليلة':'في المخزن'}</span><span class="stock-actions"><button class="smallbtn order-add" data-key="${esc(g.key)}">+ للطلبية</button><button class="smallbtn audit-open" data-key="${esc(g.key)}">جرد فعلي</button></span></div></article>`}
function renderInventory(){
  const q=nameKey($('search').value),f=$('filter').value;
  const found=state.groups.filter(g=>{
    if(q&&!nameKey(g.name).includes(q))return false;
    if(f==='available')return g.quantity>0;
    if(f==='out')return g.quantity===0;
    if(f==='negative')return g.quantity<0;
    if(f==='low')return g.quantity>0&&g.quantity<=state.low;
    if(f==='changed')return state.deltaMap.has(g.key);
    return true;
  });
  $('resultCount').textContent=fmtn(found.length)+' نتيجة';
  const visible=found.slice(0,state.shown);
  $('inventoryList').innerHTML=visible.length?visible.map(productCard).join(''):`<div class="empty">${!state.snapshots.length?'ارفع ملف mat.xls أو ملف بيانات الجرد للبدء.':'ماكو مواد تطابق البحث.'}</div>`;
  $('loadMore').hidden=found.length<=visible.length;
  $('loadMore').textContent=`عرض المزيد (${fmtn(found.length-visible.length)} باقي)`;
}
/* Purchase/fulfillment order: draft is stored locally, independent from stock amounts.
 * WhatsApp invite links navigate to a group, but cannot prefill and send messages into it. */
const FULFILLMENT_GROUP_URL='https://chat.whatsapp.com/Ii4ka6sJg2144m47d6Q2OU?s=cl&p=i&mlu=4&ilr=4';
async function copyWhatsAppText(message){
  try {
    if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(message);return true}
  }catch(e){console.warn('Clipboard API unavailable',e)}
  try {
    const field=document.createElement('textarea');
    field.value=message;field.setAttribute('readonly','');
    field.style.cssText='position:fixed;top:0;left:-9999px;opacity:0';
    document.body.appendChild(field);field.focus();field.select();
    const ok=document.execCommand('copy');field.remove();
    return Boolean(ok);
  }catch(e){console.warn('Clipboard fallback unavailable',e);return false}
}
async function sendOrderToGroup(order=null){
  const items=order?.items||state.orderItems;
  if(!items.length)return alertBox('أضف مادة للطلبية أولاً.','error');
  // WhatsApp group invitation URLs do not transmit messages into that group.
  // WhatsApp's recipient picker will open with the order message already filled in.
  const message=currentOrderText(order);
  const link='https://wa.me/?text='+encodeURIComponent(message);
  if(link.length>12000&&navigator.share){
    try{await navigator.share({text:message});return}catch(err){if(err?.name==='AbortError')return}
  }
  window.location.assign(link);
}

function currentOrderText(order=null){
  const items=order?.items||state.orderItems;
  const customer=String(order?.customer??state.orderCustomer);
  const phone=String(order?.phone??state.orderCustomerPhone);
  const note=String(order?.note??state.orderGeneralNote);
  const stamp=new Date(order?.savedAt||Date.now()).toLocaleString('ar-IQ',{dateStyle:'short',timeStyle:'short'});
  const lines=['*طلبية تجهيز - سما اللباب*'];
  if(customer.trim())lines.push('الزبون/الجهة: '+customer.trim());
  if(phone.trim())lines.push('رقم الزبون: '+phone.trim());
  lines.push('التاريخ: '+stamp,'');
  items.forEach((item,i)=>{lines.push((i+1)+'. '+item.name+' — الكمية: '+fmtn(item.quantity));if(item.note)lines.push('   ملاحظة: '+item.note)});
  if(note.trim())lines.push('','ملاحظات عامة: '+note.trim());
  lines.push('','يرجى تأكيد التجهيز.');
  return lines.join('\n');
}
function renderSavedOrders(){
  const items=state.savedOrders;
  $('savedOrdersCount').textContent=fmtn(items.length)+' قائمة';
  $('savedOrdersList').innerHTML=items.length?items.map(o=>`<div class="saved-order-item" data-saved-id="${esc(o.id)}"><div class="save-title">${esc(o.customer||'طلبية بدون اسم')}</div><div class="saved-meta">${o.phone?esc(o.phone)+' • ':''}${fmtn(o.items.length)} مادة • ${new Date(o.savedAt).toLocaleString('ar-IQ')}</div><div class="saved-actions"><button class="smallbtn open-saved" type="button" data-saved-id="${esc(o.id)}">فتح وتعديل</button><button class="smallbtn send-saved" type="button" data-saved-id="${esc(o.id)}">مشاركة بالواتساب (اختار الكروب)</button><button class="smallbtn delete-saved" type="button" data-saved-id="${esc(o.id)}">حذف</button></div></div>`).join(''):'<div class="empty">ما عندك قوائم محفوظة بعد. أضف مواد وبعدين اضغط «حفظ ضمن القوائم».</div>';
}
async function saveCurrentOrder(){
  if(!state.orderItems.length)return alertBox('أضف مادة للطلبية أولاً.','error');
  const item={id:'saved-'+Date.now()+'-'+Math.random().toString(36).slice(2),savedAt:new Date().toISOString(),customer:state.orderCustomer.trim(),phone:state.orderCustomerPhone.trim(),note:state.orderGeneralNote.trim(),items:state.orderItems.map(i=>({...i}))};
  state.savedOrders.unshift(item);
  await saveOrderDraft();renderSavedOrders();alertBox('انحفظت الطلبية بالقوائم. تگدر تفتحها وترسلها للواتساب بأي وقت.');
}
async function savedOrderAction(e){
  const action=e.target.closest('button[data-saved-id]');if(!action)return;
  const saved=state.savedOrders.find(i=>i.id===action.dataset.savedId);if(!saved)return;
  if(action.classList.contains('send-saved')){
    await sendOrderToGroup(saved);return;
  }
  if(action.classList.contains('delete-saved')){
    if(!confirm('متأكد تريد تحذف هذي الطلبية من القوائم؟'))return;
    state.savedOrders=state.savedOrders.filter(i=>i.id!==saved.id);await saveOrderDraft();renderSavedOrders();return;
  }
  if(action.classList.contains('open-saved')){
    if(state.orderItems.length&&!confirm('تفتح القائمة المحفوظة وتستبدل مسودة الطلبية الحالية؟'))return;
    state.orderItems=saved.items.map(i=>({...i}));state.orderCustomer=saved.customer||'';state.orderCustomerPhone=saved.phone||'';state.orderGeneralNote=saved.note||'';
    $('orderCustomer').value=state.orderCustomer;$('orderCustomerPhone').value=state.orderCustomerPhone;$('orderGeneralNote').value=state.orderGeneralNote;
    await saveOrderDraft();renderOrder();tabChange('orders');
  }
}
function renderOrder(){
  const items=state.orderItems;
  $('orderCount').textContent=fmtn(items.length)+' مادة';
  $('orderTabCount').textContent=fmtn(items.length);
  $('orderUnitCount').textContent=fmtn(items.reduce((s,i)=>s+i.quantity,0))+' قطعة';
  $('orderItems').innerHTML=items.length?items.map(item=>{
    const stock=lookupStock(item.name,item.key),stockText=orderStockCaption(item);
    return `<article class="product-card order-line" data-order-id="${esc(item.id)}"><div><div class="product-title">${esc(item.name)}</div><div class="stock-balance ${!stock?'unavailable':stock.quantity<=0?'low':''}">${esc(stockText)}</div>${item.note?`<div class="product-sub">${esc(item.note)}</div>`:''}</div><div class="order-line-actions"><span class="qty">× ${fmtn(item.quantity)}</span><button type="button" class="smallbtn order-edit" data-order-id="${esc(item.id)}">تعديل</button><button type="button" class="smallbtn order-remove" data-order-id="${esc(item.id)}">حذف</button></div></article>`
  }).join(''):'<div class="empty">الطلبية فارغة. ابحث عن مادة واضغط «إضافة»، أو اضغط «+ للطلبية» من المخزون.</div>';
  $('orderMessagePreview').textContent=items.length?currentOrderText():'أضف مادة حتى تتكوّن رسالة الطلبية.';
  $('shareOrder').disabled=!items.length;$('copyOrder').disabled=!items.length;$('saveOrder').disabled=!items.length;
}
function renderOrderSuggestions(){
  const q=nameKey($('orderSearch').value),cq=compactNameKey(q);
  if(!q){$('orderSuggestions').innerHTML='';return}
  if(!state.snapshots.length){
    $('orderSuggestions').innerHTML='<div class="stock-info missing">⚠️ لازم ترفع ملف الجرد من زر «تحديث الجرد» حتى يطلع رصيد أي مادة. تگدر تضيف مادة يدوية، بس بدون رصيد معتمد.</div>';
    return;
  }
  const list=state.groups.filter(g=>nameKey(g.name).includes(q)||(cq&&compactNameKey(g.name).includes(cq))).slice(0,30);
  $('orderSuggestions').innerHTML=list.length?list.map(g=>`<div class="order-suggest"><div><strong>${esc(g.name)}</strong><span class="stock-balance ${g.quantity<=0?'low':''}">المتوفر بالمخزن: ${fmtn(g.quantity)} قطعة</span></div><button class="smallbtn order-add" type="button" data-key="${esc(g.key)}">+ إضافة</button></div>`).join(''):'<div class="stock-info">ما لكينا مادة مطابقة بالجرد الحالي. جرّب اسم ثاني أو أضف مادة يدوية (بدون رصيد معتمد).</div>';
}

function showOrderDialog(key=null,id=null){
  const item=id?state.orderItems.find(x=>x.id===id):null;
  const product=key?state.groupMap.get(key):null;
  state.editingOrderId=item?.id||null;
  state.orderSelectedKey=product?.key||item?.key||null;
  $('orderDialogTitle').textContent=item?'تعديل مادة الطلبية':'إضافة مادة للطلبية';
  $('saveOrderItem').textContent=item?'حفظ التعديل':'إضافة للطلبية';
  $('orderItemName').value=item?.name||product?.name||'';
  $('orderItemName').readOnly=Boolean(product)||Boolean(item?.key&&state.groupMap.has(item.key));
  $('orderItemQty').value=item?.quantity??1;
  $('orderItemNote').value=item?.note||'';
  updateOrderStockPreview();
  $('orderDialog').showModal();
  if(!product&&!item)$('orderItemName').focus();else $('orderItemQty').focus();
}
function updateOrderStockPreview(){
  const curr=lookupStock($('orderItemName').value,state.orderSelectedKey);
  $('orderCurrentStock').textContent=curr?'المتوفر بالمخزن: '+fmtn(curr.quantity)+' قطعة (الرصيد ما يتغير بمجرد الطلب)':state.snapshots.length?'المادة مو موجودة بالجرد الحالي — دقّق الاسم':'ماكو جرد محمّل حتى نعرف كمية المادة';
}
async function saveOrderDraft(){try{await storageWrite()}catch(err){console.warn('Order storage error',err);alertBox('تعذر حفظ الطلبية على هذا الجهاز. تگدر تنسخها احتياطياً.','error')}}
async function storeOrderItem(){
  const name=cleanName($('orderItemName').value),qty=Number($('orderItemQty').value),note=$('orderItemNote').value.trim();
  if(!name)return alertBox('اكتب اسم المادة.','error');
  if(!Number.isFinite(qty)||qty<=0||!$('orderItemQty').value)return alertBox('الكمية لازم أكبر من صفر.','error');
  const linked=state.orderSelectedKey&&state.groupMap.get(state.orderSelectedKey);
  const matchKey=linked?.key||nameKey(name);
  const old=state.editingOrderId?state.orderItems.find(i=>i.id===state.editingOrderId):state.orderItems.find(i=>i.key===matchKey);
  if(old){old.name=name;old.key=matchKey;old.quantity=state.editingOrderId?qty:old.quantity+qty;if(note)old.note=note;else if(state.editingOrderId)old.note=''}
  else state.orderItems.push({id:'order-'+Date.now()+'-'+Math.random().toString(36).slice(2),key:matchKey,name,quantity:qty,note});
  $('orderDialog').close();await saveOrderDraft();renderOrder();
  $('orderSearch').value='';renderOrderSuggestions();
  tabChange('orders');
}
async function sendToWhatsApp(){
  await sendOrderToGroup();
}
async function copyOrder(){
  if(!state.orderItems.length)return;
  const message=currentOrderText();
  try{await navigator.clipboard.writeText(message);alertBox('تم نسخ الطلبية. افتح كروب المجهزين بالواتساب والصقها هناك.')}catch{
    const el=document.createElement('textarea');el.value=message;el.style.position='fixed';el.style.opacity='0';document.body.appendChild(el);el.focus();el.select();const ok=document.execCommand('copy');el.remove();
    alertBox(ok?'تم نسخ الطلبية. الصقها بالواتساب.':'ما كدرنا ننسخها. افتح معاينة الرسالة وحدد النص وانسخه.',ok?'ok':'error');
  }
}
function renderChanges(){
  const prev=state.snapshots[1],cur=state.snapshots[0];
  if(!prev||!cur){$('changesOverview').innerHTML='';$('changesList').innerHTML='<div class="empty">بعد ما ترفع جرد الأسبوع القادم راح نظهر الزيادات والنواقص هنا تلقائياً.</div>';return}
  const more=state.deltas.filter(d=>d.delta>0).length,less=state.deltas.filter(d=>d.delta<0).length;
  const totalNow=cur.products.reduce((s,p)=>s+p.quantity,0),totalBefore=prev.products.reduce((s,p)=>s+p.quantity,0);
  $('changesOverview').innerHTML=`<div class="mini-stat">${esc(prev.date)} ← ${esc(cur.date)}</div><div class="mini-stat">مواد ارتفعت: <strong class="delta-positive">${fmtn(more)}</strong></div><div class="mini-stat">مواد انخفضت: <strong class="delta-negative">${fmtn(less)}</strong></div><div class="mini-stat">فرق مجموع الوحدات: <strong>${fmtn(totalNow-totalBefore)}</strong></div>`;
  const search=nameKey($('changesSearch').value),filter=$('changesFilter').value;
  const data=state.deltas.filter(d=>(filter==='all'||filter===d.kind)&&(!search||nameKey(d.name).includes(search)));
  $('changesList').innerHTML=data.length?data.slice(0,500).map(d=>`<article class="product-card"><div><div class="product-title">${esc(d.name)}</div><div class="product-sub">السابق: ${fmtn(d.before)} | الحالي: ${fmtn(d.after)}${d.kind==='new'?' — اسم جديد':d.kind==='gone'?' — الاسم اختفى من الملف':''}</div></div><div><strong class="quantity ${d.delta<0?'red':''}" style="color:${d.delta>0?'#178269':''}">${d.delta>0?'+':''}${fmtn(d.delta)}</strong><span class="qtylabel">الفرق</span></div></article>`).join(''):'<div class="empty">ماكو تغيرات تطابق البحث.</div>';
}
function auditData(){const curr=state.snapshots[0];return curr?state.audits.filter(a=>a.snapshotKey===curr.key).sort((a,b)=>b.at.localeCompare(a.at)):[]}
function renderAudits(){const rows=auditData(),mismatches=rows.filter(a=>a.delta!==0).length;$('auditSummary').textContent=rows.length?`تم تسجيل ${rows.length} عملية مطابقة للجرد الحالي — ${mismatches} منها فيها فرق.`:'لا يوجد جرد يدوي مسجل. اختار مادة من تبويب المخزون واضغط «جرد فعلي».';
 $('auditList').innerHTML=rows.length?rows.map(a=>`<article class="product-card"><div><div class="product-title">${esc(a.name)}</div><div class="product-sub">الرصيد: ${fmtn(a.expected)} | الفعلي: ${fmtn(a.actual)} | ${new Date(a.at).toLocaleString('ar-IQ')} ${a.note?' | '+esc(a.note):''}</div></div><div><strong class="quantity ${a.delta<0?'red':''}" style="color:${a.delta>0?'#178269':''}">${a.delta>0?'+':''}${fmtn(a.delta)}</strong><span class="qtylabel">فرق الجرد</span></div></article>`).join(''):'<div class="empty">لم يتم تسجيل مطابقة يدوية بعد.</div>';
}
function renderSnapshots(){const sn=state.snapshots;$('snapshotsList').innerHTML=sn.length?sn.map((s,i)=>`<div class="snapshot"><span><strong>${i===0?'الأحدث: ':''}${esc(s.date)}</strong><br/><small>${esc(s.filename)}</small></span><span>${fmtn(s.products.length)} سجل</span></div>`).join(''):'ماكو ملفات محفوظة.'}
function tabChange(tab){state.activeTab=tab;document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active',p.id===tab));window.scrollTo({top:0,behavior:'smooth'})}
function openAudit(key){const g=state.groupMap.get(key);if(!g)return;state.activeAuditName=key;$('auditProductName').textContent=g.name;$('auditExpected').textContent=fmtn(g.quantity);$('auditActual').value='';$('auditNote').value='';$('auditDialog').showModal()}
function filename(s){return String(s||'file').replace(/[^a-zA-Z0-9\-_.]/g,'_')}
function downloadBlob(content,name,type){const obj=new Blob([content],{type});const url=URL.createObjectURL(obj),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)}
function downloadCSV(rows,headers,file){const csv='\ufeff'+[headers,...rows].map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');downloadBlob(csv,file,'text/csv;charset=utf-8')}
async function importSnapshot(raw){const snapshot=normalizeSnapshot(raw);if(state.snapshots.some(s=>s.key===snapshot.key)) {alertBox('هذا الجرد نفسه محفوظ مسبقاً، وما يحتاج تستورده مرة ثانية.');return false}
 state.snapshots.unshift(snapshot);state.snapshots=state.snapshots.slice(0,16);await storageWrite();state.shown=80;refresh();alertBox(`تم اعتماد جرد ${snapshot.date}: ${fmtn(snapshot.products.length)} سجل، مجموع الكميات ${fmtn(snapshot.products.reduce((t,p)=>t+p.quantity,0))}.`);return true}
function asDataView(bytes){return new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)}
/* Small, dependency-free BIFF8 reader for legacy Morabaa .xls exports.
 * It only reads text LABEL records. No data ever leaves the browser. */
function parseLegacyXLS(buffer,fileName){
 const data=new Uint8Array(buffer), v=asDataView(data), u16=n=>v.getUint16(n,true),u32=n=>v.getUint32(n,true);
 if(data.length<512||u32(0)!==0xE011CFD0||u32(4)!==0xE11AB1A1)throw new Error('الملف مو بصيغة XLS القديمة الصحيحة.');
 const secSize=2**u16(30);if(secSize!==512&&secSize!==4096)throw new Error('قطاع XLS غير مدعوم.');
 const fatSectors=[];for(let i=0;i<109;i++){const x=u32(76+i*4);if(x<0xFFFFFFFC)fatSectors.push(x)}
 let difat=u32(68),difatCount=u32(72);
 for(let z=0;z<difatCount&&difat<0xFFFFFFFC;z++){
  const off=(difat+1)*secSize;
  for(let i=0;i<secSize/4-1;i++){const x=u32(off+i*4);if(x<0xFFFFFFFC)fatSectors.push(x)}
  difat=u32(off+secSize-4);
 }
 const fat=[];for(const id of fatSectors){const off=(id+1)*secSize;if(off+secSize>data.length)throw new Error('ملف إكسل ناقص.');for(let i=0;i<secSize/4;i++)fat.push(u32(off+i*4))}
 function stream(start,size){let id=start;const parts=[],seen=new Set();let bytes=0;
  while(id<0xFFFFFFFC&&id<fat.length&&!seen.has(id)){
   seen.add(id);const off=(id+1)*secSize;if(off+secSize>data.length)break;parts.push(data.subarray(off,off+secSize));bytes+=secSize;id=fat[id];
   if(size!==undefined&&bytes>=size)break;
  }
  const result=new Uint8Array(size===undefined?bytes:Math.min(size,bytes));let pos=0;for(const part of parts){const n=Math.min(part.length,result.length-pos);result.set(part.subarray(0,n),pos);pos+=n;if(pos>=result.length)break}return result;
 }
 const dirs=stream(u32(48));const decoder=new TextDecoder('utf-16le');let workbookStart=null,workbookSize=0;
 for(let pos=0;pos+128<=dirs.length;pos+=128){const dv=asDataView(dirs.subarray(pos,pos+128));const len=dv.getUint16(64,true);if(len<2||len>64)continue;
  const name=decoder.decode(dirs.subarray(pos,pos+len-2));
  if(name==='Workbook'||name==='Book'){workbookStart=dv.getUint32(116,true);workbookSize=dv.getUint32(120,true);break}
 }
 if(workbookStart===null)throw new Error('ما لگينا ورقة الإكسل بداخل الملف.');
 const book=stream(workbookStart,workbookSize),bv=asDataView(book),rows=new Map();
 for(let pos=0;pos+4<=book.length;){const code=bv.getUint16(pos,true),len=bv.getUint16(pos+2,true);const at=pos+4;if(at+len>book.length)break;
  if(code===0x0204&&len>=9){const row=bv.getUint16(at,true),col=bv.getUint16(at+2,true),chars=bv.getUint16(at+6,true),flags=book[at+8],needed=chars*(flags&1?2:1);
   if(9+needed<=len){let value;if(flags&1){value=decoder.decode(book.subarray(at+9,at+9+needed))}else{value='';for(let k=0;k<needed;k++)value+=String.fromCharCode(book[at+9+k])}
    if(!rows.has(row))rows.set(row,new Map());rows.get(row).set(col,value);
   }
  }
  pos+=4+len;
 }
 const header=[...rows.entries()].find(([,c])=>[...c.values()].includes('المادة')&&[...c.values()].includes('العدد'));
 if(!header)throw new Error('هذا الملف لا يحتوي أعمدة (المادة) و(العدد) بصيغة المربّع المعتمدة.');
 const cols=new Map([...header[1]].map(([c,v])=>[cleanName(v),c]));const get=(row,name)=>String(row.get(cols.get(name))??'');
 const products=[];let date='';
 for(const [r,c] of [...rows].sort((a,b)=>a[0]-b[0])){
  for(const val of c.values())if(/^20\d\d-\d\d-\d\d$/.test(val)&&!date)date=val;
  if(r<=header[0])continue;
  const name=get(c,'المادة'),line=get(c,'تـ').replace(/,/g,'');if(!name||!/^\d+$/.test(line))continue;
  products.push({line:Number(line),name,quantity:parseNumber(get(c,'العدد')),wholesale:get(c,'سعر الجملة'),sale:get(c,'سعر البيع'),lastPurchase:get(c,'اخر سعر شراء'),purchase:get(c,'سعر الشراء')});
 }
 if(!products.length)throw new Error('لم يتم العثور على سجل مواد في XLS.');
 return {kind:'sama-allubab-inventory',date:date||new Date().toISOString().slice(0,10),filename:fileName,products};
}
async function importFromFile(file,backupOnly=false){if(!file)return;try{
  if(file.size>30*1024*1024)throw new Error('حجم الملف كبير جداً.');
  const suffix=file.name.split('.').pop().toLowerCase();
  if(suffix==='xlsx')throw new Error('الملف بصيغة XLSX. حالياً استورد XLS من نظام المربّع أو JSON المرفق.');
  if(suffix==='xls'){
    if(backupOnly)throw new Error('استعادة النسخة الاحتياطية تحتاج ملف JSON.');
    const snap=parseLegacyXLS(await file.arrayBuffer(),file.name);await importSnapshot(snap);return;
  }
  if(suffix!=='json')throw new Error('اختر ملف XLS أو JSON فقط.');
  const content=JSON.parse(await file.text());
  if(content.kind==='sama-allubab-backup'){
   if(!Array.isArray(content.snapshots)||!Array.isArray(content.audits))throw new Error('هيكل النسخة الاحتياطية غير صحيح.');
   const merged=new Map([...state.snapshots.map(s=>[s.key,s])]);for(const s of content.snapshots){const valid=normalizeSnapshot(s);merged.set(valid.key,{...s,...valid,created:s.created||new Date().toISOString()})}
   state.snapshots=[...merged.values()].sort((a,b)=>(b.created||'').localeCompare(a.created||'')).slice(0,16);
   const audits=new Map(state.audits.map(a=>[a.id,a]));for(const a of content.audits)if(a.id&&a.snapshotKey)audits.set(a.id,a);state.audits=[...audits.values()];
   if(Array.isArray(content.orderItems))state.orderItems=content.orderItems.filter(x=>x&&typeof x.name==='string'&&Number.isFinite(x.quantity)&&x.quantity>0).slice(0,500);
   if(typeof content.orderCustomer==='string')state.orderCustomer=content.orderCustomer.slice(0,90);
   if(typeof content.orderCustomerPhone==='string')state.orderCustomerPhone=content.orderCustomerPhone.slice(0,25);
   if(typeof content.orderGeneralNote==='string')state.orderGeneralNote=content.orderGeneralNote.slice(0,350);
   if(Array.isArray(content.savedOrders))state.savedOrders=content.savedOrders.filter(x=>x&&typeof x.id==='string'&&Array.isArray(x.items)&&typeof x.savedAt==='string').slice(0,500);
   $('orderCustomer').value=state.orderCustomer;$('orderCustomerPhone').value=state.orderCustomerPhone;$('orderGeneralNote').value=state.orderGeneralNote;
   await storageWrite();refresh();alertBox(`تم استعادة ${state.snapshots.length} ملف جرد و${state.audits.length} سجل مطابقة.`);return;
  }
  if(backupOnly)throw new Error('الملف مو نسخة احتياطية؛ من تحديث الجرد تگدر تستورد ملف المواد.');
  await importSnapshot(content);
 }catch(err){console.error(err);alertBox('تعذر استيراد الملف: '+(err?.message||String(err)),'error')}
}
function setup(){
 document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>tabChange(b.dataset.tab)));
 document.querySelectorAll('.stat').forEach(b=>b.addEventListener('click',()=>{$('filter').value=b.dataset.filter;state.shown=80;tabChange('inventory');renderInventory()}));
 $('fileInput').addEventListener('change',async e=>{await importFromFile(e.target.files[0]);e.target.value='' });
 $('backupInput').addEventListener('change',async e=>{await importFromFile(e.target.files[0],true);e.target.value='' });
 $('search').addEventListener('input',()=>{state.shown=80;renderInventory()});$('filter').addEventListener('change',()=>{state.shown=80;renderInventory()});
 $('lowThreshold').addEventListener('input',()=>{state.low=Math.max(1,parseNumber($('lowThreshold').value));renderInventory()});
 $('loadMore').addEventListener('click',()=>{state.shown+=80;renderInventory()});
 $('changesSearch').addEventListener('input',renderChanges);$('changesFilter').addEventListener('change',renderChanges);
 $('inventoryList').addEventListener('click',e=>{const a=e.target.closest('.order-add');if(a){showOrderDialog(a.dataset.key);return}const b=e.target.closest('.audit-open');if(b)openAudit(b.dataset.key)});
 $('orderSuggestions').addEventListener('click',e=>{const a=e.target.closest('.order-add');if(a)showOrderDialog(a.dataset.key)});
 $('orderSearch').addEventListener('input',renderOrderSuggestions);
 $('addCustomItem').addEventListener('click',()=>showOrderDialog());
 $('orderItemName').addEventListener('input',updateOrderStockPreview);
 $('closeOrderDialog').addEventListener('click',()=>$('orderDialog').close());
 $('orderItemForm').addEventListener('submit',async e=>{e.preventDefault();await storeOrderItem()});
 $('orderItems').addEventListener('click',async e=>{const edit=e.target.closest('.order-edit'),remove=e.target.closest('.order-remove');if(edit){showOrderDialog(null,edit.dataset.orderId)}else if(remove){state.orderItems=state.orderItems.filter(i=>i.id!==remove.dataset.orderId);await saveOrderDraft();renderOrder()}});
 $('orderCustomer').addEventListener('input',e=>{state.orderCustomer=e.target.value;saveOrderDraft();renderOrder()});
 $('orderCustomerPhone').addEventListener('input',e=>{state.orderCustomerPhone=e.target.value;saveOrderDraft();renderOrder()});
 $('orderGeneralNote').addEventListener('input',e=>{state.orderGeneralNote=e.target.value;saveOrderDraft();renderOrder()});
 $('shareOrder').addEventListener('click',sendToWhatsApp);
 $('openFulfillmentGroup').addEventListener('click',async()=>{
  if(!state.orderItems.length)return alertBox('أضف مادة للطلبية أولاً.','error');
  const copied=await copyWhatsAppText(currentOrderText());
  if(!copied)return alertBox('تعذر نسخ الطلبية. استخدم زر مشاركة الطلبية بالواتساب، وبعدها اختار الكروب.','error');
  window.location.assign(FULFILLMENT_GROUP_URL);
 });
 $('saveOrder').addEventListener('click',saveCurrentOrder);
 $('savedOrdersList').addEventListener('click',savedOrderAction);
 $('goToOrders').addEventListener('click',()=>tabChange('orders'));
 $('copyOrder').addEventListener('click',copyOrder);
 $('clearOrder').addEventListener('click',async ()=>{if(!state.orderItems.length&&!state.orderCustomer.trim()&&!state.orderCustomerPhone.trim()&&!state.orderGeneralNote.trim())return;if(!confirm('تمسح الطلبية الحالية وتبدأ طلبية جديدة؟'))return;state.orderItems=[];state.orderCustomer='';state.orderCustomerPhone='';state.orderGeneralNote='';$('orderCustomer').value='';$('orderCustomerPhone').value='';$('orderGeneralNote').value='';await saveOrderDraft();renderOrder();alertBox('تم تفريغ الطلبية. تگدر تبدأ طلبية جديدة.')});
 $('closeDialog').addEventListener('click',()=>$('auditDialog').close());
 $('auditForm').addEventListener('submit',async e=>{
  e.preventDefault();const g=state.groupMap.get(state.activeAuditName),curr=state.snapshots[0];if(!g||!curr)return;
  const actual=Number($('auditActual').value);if(!Number.isFinite(actual)||$('auditActual').value===''){alertBox('اكتب العدد الفعلي بشكل صحيح.','error');return}
  const audit={id:'audit-'+Date.now()+'-'+Math.random().toString(36).slice(2),snapshotKey:curr.key,key:g.key,name:g.name,expected:g.quantity,actual,delta:actual-g.quantity,note:$('auditNote').value.trim(),at:new Date().toISOString()};
  state.audits.push(audit);await storageWrite();$('auditDialog').close();renderAudits();tabChange('audit');alertBox('تم حفظ المطابقة. الرصيد الأصلي ما تغير.')
 });
 $('exportChanges').addEventListener('click',()=>{if(!state.snapshots[1])return alertBox('لا توجد مقارنة بعد.','error');downloadCSV(state.deltas.map(d=>[d.name,d.before,d.after,d.delta,d.kind]),['المادة','السابق','الحالي','الفرق','نوع التغيير'],'sama-stock-differences.csv')});
 $('exportAudit').addEventListener('click',()=>{const items=auditData();if(!items.length)return alertBox('ماكو مطابقات محفوظة بعد.','error');downloadCSV(items.map(a=>[a.name,a.expected,a.actual,a.delta,a.note,a.at]),['المادة','رصيد البرنامج','الفعلي','الفرق','ملاحظة','الوقت'],'sama-stock-physical-count.csv')});
 $('backupBtn').addEventListener('click',()=>{if(!state.snapshots.length)return alertBox('ماكو بيانات لنسخها.','error');downloadBlob(JSON.stringify({kind:'sama-allubab-backup',schemaVersion:1,exported:new Date().toISOString(),snapshots:state.snapshots,audits:state.audits,orderItems:state.orderItems,orderCustomer:state.orderCustomer,orderCustomerPhone:state.orderCustomerPhone,orderGeneralNote:state.orderGeneralNote,savedOrders:state.savedOrders}),`sama-inventory-backup-${new Date().toISOString().slice(0,10)}.json`,'application/json;charset=utf-8')});
 $('btnHelp').addEventListener('click',()=>{tabChange('settings');alertBox('1) استورد ملف mat.xls من الأعلى. 2) شوف المواد والتنبيهات. 3) ارفع ملف جديد بالأسبوع المقبل للمقارنة. 4) من «قوائم الطلبيات» أضف المواد وحدد الكميات. اضغط «مشاركة الطلبية بالواتساب»، واختار كروب تجهيز الطلبات، بعدها اضغط إرسال من داخل واتساب. 5) احفظ نسخة احتياطية كل فترة.')});
}
async function main(){setup();try{const saved=await storageRead();if(saved){state.snapshots=Array.isArray(saved.snapshots)?saved.snapshots:[];state.audits=Array.isArray(saved.audits)?saved.audits:[];state.orderItems=Array.isArray(saved.orderItems)?saved.orderItems:[];state.orderCustomer=typeof saved.orderCustomer==='string'?saved.orderCustomer:'';state.orderCustomerPhone=typeof saved.orderCustomerPhone==='string'?saved.orderCustomerPhone:'';state.orderGeneralNote=typeof saved.orderGeneralNote==='string'?saved.orderGeneralNote:'';state.savedOrders=Array.isArray(saved.savedOrders)?saved.savedOrders:[];$('orderCustomer').value=state.orderCustomer;$('orderGeneralNote').value=state.orderGeneralNote}}catch(err){console.warn('IndexedDB unavailable',err);alertBox('تعذّر فتح مساحة التخزين على هذا الجهاز. استخدم Safari وتأكد من عدم تشغيل التصفح الخاص.','error')}
 refresh();if(location.hash==='#orders'||new URLSearchParams(location.search).get('page')==='orders')tabChange('orders');if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(e=>console.log(e));}
document.addEventListener('DOMContentLoaded',main);
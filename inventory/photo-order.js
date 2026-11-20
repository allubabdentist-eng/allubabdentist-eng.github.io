/* Read order screenshots on the device. Stock and draft are provided by the inventory app. */
const photoOrders = (() => {
  const sizePattern = /(\d+(?:\.\d+)?)\s*(?:mm|ملم)?\s*[x×*✕]\s*(\d+(?:\.\d+)?)/i;
  const countPrefix = /(?:الكمية|الكميه|كمية|كميه|عدد|qty|quantity)\s*[:=×x-]?\s*(\d+)\b/i;
  const countSuffix = /(\d+)\s*(?:p\s*c\s*s?\b|pieces?\b|units?\b|boxes?\b|قطع(?:ة|ه)?|حبات|حبه|حبة|علب(?:ة|ه)?)/i;
  const aliases = [
    [/\b(?:tads?|t\.a\.d\.?s?|bio\s*tack|mini[ -]?(?:screws?|implants?))\b|ميني\s*(?:سكرو|سكر[وو]|امبلانت)|(?:مسمار|برغي)\s*(?:تقويم(?:ي)?|اورثو)|تادات|تادز|تاد/gi,'tad'],
    [/\bm[ -]?pro\b|ام\s*برو/gi,'mpro'],
    [/\bni[ -]?ti\b|ناي\s*تاي/gi,'niti'],
    [/\bbrackets?\b|براكتات|براكت/gi,'bracket'],
    [/\bwires?\b|وايرات|واير/gi,'wire']
  ];
  const ignoreWords = new Set('اريد اريدلك نريد مطلوب عندكم عندك رجاء ممكن السلام عليكم دكتور دكتوره عدد الكمية كمية قياس مقاس نوع من في على ال ب قطعة قطع حبة علبة شكرا please need pcs piece pieces size mm ملم the for and with in to of by منكم مال ويا لو اذا'.split(' '));
  let catalog = [], review = [], scanNumber = 0, ocrLibrary;

  function normalize(value) {
    return String(value || '').normalize('NFKC').toLowerCase()
      .replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776))
      .replace(/[\u064b-\u065f\u0670\u0640\u200e\u200f]/g,'').replace(/[أإآٱ]/g,'ا')
      .replace(/(\d)\s*[.,٫،]\s*(?=\d)/g,'$1.').replace(/[–—]/g,'-');
  }
  function words(text) {
    for (const [pattern, alias] of aliases) text=text.replace(pattern,' '+alias+' ');
    return [...new Set((text.match(/[a-z]{2,}|[\u0621-\u064a]{2,}/g)||[]).filter(w=>!ignoreWords.has(w)))];
  }
  function profile(text) {
    const clean=normalize(text), match=clean.match(sizePattern);
    const rest=match?clean.replace(sizePattern,' '):clean;
    return {clean,words:words(rest),size:match?[Number(match[1]),Number(match[2])]:null,
      numbers:(rest.match(/\d+(?:\.\d+)?/g)||[]).map(Number)};
  }
  function wordScore(a,b) {
    if(a===b)return 1;
    if(Math.min(a.length,b.length)<4)return 0;
    if(a.startsWith(b)||b.startsWith(a))return .8;
    if(Math.abs(a.length-b.length)>1)return 0;
    let i=0,j=0,changes=0;
    while(i<a.length && j<b.length) {
      if(a[i]===b[j]){i++;j++;continue;}
      if(++changes>1)return 0;
      if(a.length>=b.length)i++;
      if(b.length>=a.length)j++;
    }
    return changes+(a.length-i)+(b.length-j)<=1?.7:0;
  }
  function rank(query) {
    const q=profile(query);
    if(!q.words.length && !q.size && !q.numbers.length)return [];
    const matches=[];
    for(const entry of catalog) {
      const p=entry.spec;
      const hits=q.words.map(w=>p.words.reduce((best,v)=>Math.max(best,wordScore(w,v)),0));
      const wordMatch=hits.length?hits.reduce((a,b)=>a+b,0)/hits.length:0;
      const sameSize=Boolean(q.size && p.size && q.size.every((n,i)=>n===p.size[i]));
      const sameNumbers=q.numbers.filter(n=>p.numbers.includes(n)).length;
      const nearSize=q.size && p.size && q.size.every((n,i)=>Math.abs(n-p.size[i])/Math.max(n,.01)<=.35);
      if(!wordMatch && !sameSize && !(nearSize && !q.words.length) && !(sameNumbers && !q.size && !q.words.length))continue;
      const exactName=q.clean===p.clean;
      const allWords=hits.length>0 && hits.every(n=>n===1);
      let score=wordMatch*48+sameNumbers*5+(exactName?100:0);
      if(q.size) {
        if(sameSize)score+=q.words.length && !wordMatch?24:65;
        else if(p.size)score+=12/(1+Math.abs(q.size[0]-p.size[0])*5+Math.abs(q.size[1]-p.size[1]));
      }
      const exact=exactName || (allWords && (!q.size || sameSize) && sameNumbers===q.numbers.length && (q.size || q.numbers.length));
      matches.push({group:entry.group,score,exact:Boolean(exact),sameSize,wrongSize:Boolean(q.size&&p.size&&!sameSize)});
    }
    return matches.sort((a,b)=>b.score-a.score || Number(b.group.quantity>0)-Number(a.group.quantity>0) || a.group.name.localeCompare(b.group.name));
  }
  function refreshStock() {
    catalog=state.groups.map(group=>({group,spec:profile(group.name)}));
    if(review.length)renderReview(false);
  }
  function plausibleName(line) {
    const tokens=words(normalize(line));
    if(!tokens.length || tokens.length>10)return false;
    const codeOrUI=/maximise purchases|create order|lead forms|sending|customers for your business|within chats|messenger|انشاء طلب|ادخال نص/i;
    if(codeOrUI.test(line))return false;
    return catalog.some(e=>tokens.every(w=>e.spec.words.includes(w))) ||
      tokens.some(w=>['tad','mpro','niti','bracket','wire'].includes(w));
  }
  function extract(text) {
    const rows=[];
    let pending=null, previousName='';
    function flush(){if(pending)rows.push(pending);pending=null;}
    for(const raw of text.split(/\r?\n/)){
      const line=normalize(raw).trim();
      if(!line)continue;
      const size=line.match(sizePattern);
      const withoutSize=line.replace(sizePattern,' ');
      const qty=withoutSize.match(countSuffix)||withoutSize.match(countPrefix);
      const name=line.replace(qty?.[0]||/^$/,' ').replace(/^\s*[-•|]+\s*/,'').trim();
      const named=plausibleName(name.replace(sizePattern,' '));
      if(size || (named && qty)){
        const prefix=size && !named && previousName ? previousName+' ' : '';
        if(!prefix || !pending || pending.query!==previousName)flush();
        pending={query:prefix+name,quantity:qty?Number(qty[1]):'',source:prefix+raw.trim()};
        if(qty)flush();
      }else if(qty){
        if(!pending)pending={query:previousName||name,quantity:'',source:previousName||''};
        pending.quantity=Number(qty[1]);pending.source=(pending.source+' '+raw.trim()).trim();flush();
      }else if(named){
        flush();previousName=raw.trim();pending={query:previousName,quantity:'',source:previousName};continue;
      }else{previousName='';continue;}
      previousName='';
    }
    flush();
    return rows;
  }

  function library() {
    if(window.Tesseract)return Promise.resolve(window.Tesseract);
    if(!ocrLibrary)ocrLibrary=new Promise((resolve,reject)=>{
      const tag=document.createElement('script');
      tag.src='https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
      tag.integrity='sha384-2BQ3U3OdKOb0Uczxqr41I9UvZkzr4V9Hv8uSzMMZAlmhsFClvdZX5wi5fDCzG+tM';
      tag.crossOrigin='anonymous';
      tag.onload=()=>resolve(window.Tesseract);
      tag.onerror=()=>{tag.remove();ocrLibrary=null;reject(new Error('OCR download'));};
      document.head.append(tag);
    });
    return ocrLibrary;
  }
  function suggestions(row,auto) {
    const found=rank(row.query);
    const first=found[0];
    if(auto && !row.key && first && first.group.quantity>0){
      const uniqueExact=first.exact && !found.slice(1).some(x=>x.exact);
      const bySizeOnly=!profile(row.query).words.length && first.sameSize && !found.slice(1).some(x=>x.sameSize);
      if(uniqueExact || bySizeOnly)row.key=first.group.key;
    }
    if(!found.some(x=>x.group.key===row.key))row.key='';
    const top=found.slice(0,12);
    if(row.key && !top.some(x=>x.group.key===row.key))top.push(found.find(x=>x.group.key===row.key));
    return top;
  }
  function options(row,auto){
    return '<option value="">اختار الصنف من الجرد</option>'+suggestions(row,auto).map(m=>{
      const label=m.wrongSize?'قياس مختلف':m.sameSize?'نفس القياس':m.exact?'مطابق':'مقترح';
      return '<option value="'+esc(m.group.key)+'"'+(m.group.key===row.key?' selected':'')+'>'+esc(m.group.name)+' — '+label+' — الرصيد '+fmtn(m.group.quantity)+'</option>';
    }).join('');
  }
  function rowStatus(row){
    if(!catalog.length)return 'حمّل الجرد من تطبيق المخزن حتى تظهر الأصناف.';
    if(!row.key)return profile(row.query).size && !profile(row.query).words.length
      ? 'المقاس واضح. اختار الصنف أو اكتب اسم المادة يم القياس.'
      : 'راجع المقترحات أو اكتب اسم المادة للبحث بالجرد.';
    const group=state.groupMap.get(row.key);
    if(!group)return 'تغيّر الجرد. اختار الصنف من جديد.';
    const existing=state.orderItems.filter(item=>item.key===row.key).reduce((sum,item)=>sum+item.quantity,0);
    const requested=review.filter(item=>item.key===row.key).reduce((sum,item)=>sum+Number(item.quantity||0),0);
    const sizeOnly=profile(row.query).size && !profile(row.query).words.length;
    return (sizeOnly?'الاقتراح حسب القياس. راجع اسم الصنف. ':'')+(requested+existing>group.quantity?'الرصيد أقل من المطلوب. ':'')+'المتوفر بالجرد: '+fmtn(group.quantity);
  }
  function updateStates(){
    $('photoApply').disabled=$('photoPick').disabled||!review.length||review.some(r=>!r.key||!Number.isSafeInteger(Number(r.quantity))||Number(r.quantity)<=0);
    [...$('photoRows').children].forEach((node,i)=>{node.querySelector('.photo-row-status').textContent=rowStatus(review[i]);});
  }
  function renderReview(auto) {
    $('photoRows').innerHTML=review.map((row,i)=>`<article class="photo-row" data-index="${i}">
      <div class="photo-row-head"><small>${esc(row.source)}</small><button class="smallbtn" type="button" data-remove>حذف السطر</button></div>
      <label>المادة أو القياس<input data-field="query" value="${esc(row.query)}" maxlength="250" placeholder="مثلاً: تاد 1.6×8"></label>
      <label>صنف الجرد<select data-field="stock">${options(row,auto)}</select></label>
      <label>الكمية المطلوبة<input data-field="qty" type="number" inputmode="numeric" min="1" step="1" value="${esc(String(row.quantity))}"></label>
      <small class="photo-row-status"></small></article>`).join('');
    updateStates();
  }
  function requestRow(data){return {...data,key:''};}
  async function scan(files) {
    if(!files.length)return;
    const id=++scanNumber;
    const status=$('photoStatus');
    $('photoPanel').hidden=false;
    $('photoPick').disabled=true;
    $('photoApply').disabled=true;
    let worker,finished=0,failed=0,detected=0;
    try{
      status.textContent='جاري تحميل قارئ الصور…';
      const api=await library();
      if(id!==scanNumber)return;
      worker=await api.createWorker(['eng','ara'],1,{corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',logger:m=>{
        if(id===scanNumber && m.status==='recognizing text')status.textContent='قراءة الصورة '+(finished+1)+' من '+files.length+' — '+Math.round(m.progress*100)+'٪';
      }});
      await worker.setParameters({tessedit_pageseg_mode:api.PSM.SPARSE_TEXT});
      for(const file of files){
        if(id!==scanNumber)break;
        try {
          const result=await worker.recognize(file);
          if(id!==scanNumber)break;
          const batch=extract(result.data.text).map(requestRow);
          const text=$('photoText');
          text.value+=(text.value?'\n':'')+result.data.text.trim();
          for(const row of batch)suggestions(row,true);
          review.push(...batch);detected+=batch.length;
        }catch{failed++;}
        finished++;
      }
      if(id===scanNumber)status.textContent=(failed?'تعذّرت قراءة '+failed+' من الصور. ':'')+(detected?'راجع الصنف والكمية قبل إضافتهما للمسودة.':'دقّق النص أو اكتب اسم المادة والكمية.');
    }catch{if(id===scanNumber)status.textContent='تعذّر تشغيل قارئ الصور. تحقق من الإنترنت أو الصق نص الطلب بالأسفل.';}
    finally{
      if(worker)await worker.terminate().catch(()=>{});
      if(id===scanNumber){
        $('photoPick').disabled=false;
        if(!review.length)review.push(requestRow({query:'',quantity:'',source:''}));
        renderReview(false);
      }
    }
  }
  function apply(){
    if($('photoApply').disabled)return;
    const additions=review.map(row=>({group:state.groupMap.get(row.key),quantity:Number(row.quantity)}));
    if(additions.some(a=>!a.group||!Number.isSafeInteger(a.quantity)||a.quantity<=0)){renderReview(false);return;}
    for(const {group,quantity} of additions){
      const old=state.orderItems.find(item=>item.key===group.key);
      if(old)old.quantity+=quantity;
      else state.orderItems.push({id:'order-'+crypto.randomUUID(),key:group.key,name:group.name,quantity,note:''});
    }
    state.pendingFulfillment=false;
    clear();renderOrder();saveOrderDraft();
    $('orderItems').scrollIntoView({block:'center',behavior:'smooth'});
  }
  function clear(){
    scanNumber++;review=[];$('photoText').value='';$('photoFiles').value='';$('photoStatus').textContent='';
    $('photoPanel').hidden=true;$('photoPick').disabled=false;renderReview(false);
  }
  function init(){
    $('photoPick').addEventListener('click',()=>$('photoFiles').click());
    $('photoFiles').addEventListener('change',e=>{const files=Array.from(e.target.files);e.target.value='';scan(files);});
    $('photoCancel').addEventListener('click',clear);
    $('photoApply').addEventListener('click',apply);
    $('photoParse').addEventListener('click',()=>{
      const parsed=extract($('photoText').value);
      review=(parsed.length?parsed:[{query:$('photoText').value.trim().slice(0,250),quantity:'',source:''}]).map(requestRow);renderReview(true);
    });
    $('photoAddLine').addEventListener('click',()=>{
      review.push(requestRow({query:'',quantity:'',source:''}));renderReview(false);
    });
    $('photoRows').addEventListener('input',e=>{
      const card=e.target.closest('.photo-row');if(!card)return;
      const row=review[Number(card.dataset.index)];
      if(e.target.dataset.field==='query'){
        row.query=e.target.value;row.key='';
        card.querySelector('select').innerHTML=options(row,false);
      }
      if(e.target.dataset.field==='qty')row.quantity=e.target.value;
      if(e.target.dataset.field==='stock')return;
      updateStates();
    });
    $('photoRows').addEventListener('change',e=>{
      if(e.target.dataset.field!=='stock')return;
      const card=e.target.closest('.photo-row');
      review[Number(card.dataset.index)].key=e.target.value;
      updateStates();
    });
    $('photoRows').addEventListener('click',e=>{
      if(!e.target.closest('[data-remove]'))return;
      review.splice(Number(e.target.closest('.photo-row').dataset.index),1);renderReview(false);
    });
  }
  return {init,refreshStock};
})();

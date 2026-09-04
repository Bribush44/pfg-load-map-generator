const CAPACITY={28:{standard:12,pinwheel:13},36:{standard:16,pinwheel:17},48:{standard:22,pinwheel:23},53:{standard:24,pinwheel:26}};
const state={jobs:[]};
const $=s=>document.querySelector(s);
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const trailerSize=()=>Number(document.querySelector('input[name="trailer"]:checked').value);
$('#accessCode').value=localStorage.getItem('pfgAccessCode')||'';
$('#accessCode').addEventListener('change',e=>localStorage.setItem('pfgAccessCode',e.target.value.trim()));

async function imageData(file){
  const bitmap=await createImageBitmap(file),max=2000,scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();
  return canvas.toDataURL('image/jpeg',0.88);
}

async function analyzeWithAI(file){
  const code=$('#accessCode').value.trim();
  if(!code)throw new Error('Enter your private app code first.');
  localStorage.setItem('pfgAccessCode',code);
  const response=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json','X-App-Code':code},body:JSON.stringify({image:await imageData(file),trailer:trailerSize()})});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'AI analysis failed');return result;
}

function parseText(text,file,index){
  const clean=text.replace(/[|]/g,' ').replace(/\r/g,'');
  const route=(clean.match(/Route\s*#?\s*[:.-]?\s*([A-Z0-9]+)/i)||[])[1]||`ROUTE-${index+1}`;
  const date=(clean.match(/\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\b/)||[])[1]||new Date().toLocaleDateString();
  const oppk=(clean.match(/\b(OPPK[A-Z0-9-]+)\b/i)||[])[1]||'';
  const door=(clean.match(/DockDr\s*\n?\s*(\d+)/i)||[])[1]||'25';
  const pallets=[];
  const rx=/\b(\d{1,2})\s+([FRD]\d{2})\s+(\d{1,3})\s+(\d{1,5})\s+(\d{1,4})\s+([0-9 -]{1,7})/gi;
  let m; while((m=rx.exec(clean))){pallets.push({pos:+m[1],code:m[2].toUpperCase(),cube:+m[3],weight:+m[4],qty:+m[5],stops:m[6].trim().replace(/\s+/g,'-')});}
  return{id:crypto.randomUUID(),fileName:file.name,route,date,oppk,door,trailer:trailerSize(),pallets,raw:text,status:'ready'};
}

async function addFiles(files){
  for(const file of files){
    const temp={id:crypto.randomUUID(),fileName:file.name,status:'reading',progress:0,preview:URL.createObjectURL(file)};
    state.jobs.push(temp);renderQueue();
    try{
      const result=await analyzeWithAI(file);
      Object.assign(temp,{...result,id:temp.id,fileName:file.name,trailer:trailerSize(),preview:temp.preview,status:'ready'});
    }catch(e){Object.assign(temp,parseText('',file,state.jobs.indexOf(temp)),{id:temp.id,preview:temp.preview,status:'review',error:e.message||'Automatic reading failed. Enter the values below.',barcodes:{dry:'',cooler:'',frozen:''}});}
    renderQueue();renderReviews();
  }
}

function renderQueue(){
  $('#queue').innerHTML=state.jobs.map(j=>`<div class="queue-item"><img src="${j.preview||''}" alt=""><div><strong>${escapeHtml(j.fileName)}</strong><small>${j.status==='reading'?'OpenAI is reading the sheet…':`Ready to review · ${j.pallets?.length||0} pallets found`}</small>${j.error?`<small class="tag">${escapeHtml(j.error)}</small>`:''}${j.status==='reading'?'<div class="progress"><i style="width:65%"></i></div>':''}</div></div>`).join('');
}

function palletLines(job){return job.pallets.map(p=>`${p.pos}, ${p.code}, ${p.weight}, ${p.qty}, ${p.stops}`).join('\n');}
function parseLines(value){return value.split('\n').map(line=>line.trim()).filter(Boolean).map(line=>{const a=line.split(',').map(x=>x.trim());return{pos:+a[0],code:(a[1]||'').toUpperCase(),weight:+a[2]||0,qty:+a[3]||0,stops:a[4]||''};}).filter(p=>p.pos&&/^[FRD]\d{2}$/.test(p.code));}

function renderReviews(){
  const ready=state.jobs.filter(j=>j.status!=='reading');
  $('#reviewSection').classList.toggle('hidden',!ready.length);$('#finishSection').classList.toggle('hidden',!ready.length);
  $('#routeCount').textContent=`${ready.length} route${ready.length===1?'':'s'}`;
  $('#reviews').innerHTML=ready.map((j,i)=>`<details class="route-review" open><summary class="route-summary"><span>${escapeHtml(j.route)}</span><span>${j.pallets.length} pallets</span></summary><div class="route-fields">
    <label>Route #<input data-id="${j.id}" data-key="route" value="${escapeHtml(j.route)}"></label><label>Door<input data-id="${j.id}" data-key="door" value="${escapeHtml(j.door)}"></label>
    <label>OPPK<input data-id="${j.id}" data-key="oppk" value="${escapeHtml(j.oppk)}"></label><label>Date<input data-id="${j.id}" data-key="date" value="${escapeHtml(j.date)}"></label>
    <label>Dry barcode<input data-id="${j.id}" data-key="barcode-dry" value="${escapeHtml(j.barcodes?.dry||'')}"></label><label>Cooler barcode<input data-id="${j.id}" data-key="barcode-cooler" value="${escapeHtml(j.barcodes?.cooler||'')}"></label>
    <label>Frozen barcode<input data-id="${j.id}" data-key="barcode-frozen" value="${escapeHtml(j.barcodes?.frozen||'')}"></label><span></span>
    <label class="full">Pallets — one per line: position, code, weight, quantity, stops<textarea data-id="${j.id}" data-key="pallets">${escapeHtml(palletLines(j))}</textarea></label>
  </div></details>`).join('');
}

document.addEventListener('input',e=>{const id=e.target.dataset.id,key=e.target.dataset.key;if(!id)return;const job=state.jobs.find(j=>j.id===id);if(key==='pallets')job.pallets=parseLines(e.target.value);else if(key.startsWith('barcode-')){job.barcodes=job.barcodes||{};job.barcodes[key.slice(8)]=e.target.value.trim();}else job[key]=e.target.value;});
$('#cameraInput').addEventListener('change',e=>addFiles([...e.target.files]));$('#batchInput').addEventListener('change',e=>addFiles([...e.target.files]));
$('#clearButton').addEventListener('click',()=>{state.jobs.forEach(j=>j.preview&&URL.revokeObjectURL(j.preview));state.jobs=[];renderQueue();renderReviews();$('#printArea').innerHTML='';});

function zone(code){return code[0]==='F'?'freezer':code[0]==='R'?'cooler':'dry'}
function summarize(job){const out={freezer:{p:0,w:0,q:0},cooler:{p:0,w:0,q:0},dry:{p:0,w:0,q:0}};job.pallets.forEach(p=>{const z=out[zone(p.code)];z.p++;z.w+=p.weight;z.q+=p.qty});return out;}
function restraints(p){return p.weight>1200?(p.code[0]==='F'?'LOAD LOCK':'STRAP'):'';}
function isPinwheel(p,job){return job.trailer===28&&/^R0[1-4]$/.test(p.code)}
function barcodeBox(label,value){return`<div class="barcode-box">${label}${value?`<svg class="barcode" data-value="${escapeHtml(value)}"></svg>`:'<span class="barcode-missing">REVIEW VALUE</span>'}</div>`}

function mapPage(job){
  const cap=CAPACITY[job.trailer].pinwheel,sorted=[...job.pallets].sort((a,b)=>a.pos-b.pos),main=sorted.slice(0,cap),hand=sorted.slice(cap),positions=Array.from({length:cap},(_,i)=>i+1),tot=summarize(job);
  const slots=positions.map(pos=>{const p=main.find(x=>x.pos===pos);if(!p)return`<div class="slot special"><b>POSITION ${pos}</b><span>DOOR SPACE / FREEZER PIR</span></div>`;const r=restraints(p);return`<div class="slot ${zone(p.code)}"><span class="slot-num">${pos}</span><div><span class="slot-code">${p.code}</span><span class="slot-detail">${p.weight.toLocaleString()} lb · Qty ${p.qty} · Stops ${escapeHtml(p.stops)}</span></div><div>${isPinwheel(p,job)?'<span class="tag">P · ROTATE</span><br>':''}${r?`<span class="check"></span><span class="tag">${r}</span><br>`:''}<span class="check"></span>LOAD</div></div>`}).join('');
  const handHtml=hand.length?`<div class="hand-panel"><h3>HAND STACK ON BACK — OVER CAPACITY</h3><div class="hand-items">${hand.map(p=>`<div class="hand-item" style="${p.weight>200?'background:#ffe1e1':''}"><b>${p.code}</b> · ${p.weight} lb<br>Qty ${p.qty} ${p.weight>200?'<b class="tag">REVIEW</b>':''}</div>`).join('')}</div></div>`:'';
  const straps=job.pallets.filter(p=>restraints(p)==='STRAP').length,locks=job.pallets.filter(p=>restraints(p)==='LOAD LOCK').length;
  return`<section class="print-sheet"><div class="print-header"><img src="assets/pfg-logo-white.png"><h1>TRAILER LOAD MAP</h1><div class="meta">OPPK: ${escapeHtml(job.oppk)}<br>DATE: ${escapeHtml(job.date)}</div></div><div class="print-ids"><div class="id-box"><small>DOOR</small><strong>${escapeHtml(job.door)}</strong></div><div class="id-box"><small>ROUTE</small><strong>${escapeHtml(job.route)}</strong></div><div class="id-box"><small>TRAILER</small><strong>${job.trailer} FT</strong></div><div class="id-box"><small>LOADER SIGN-OFF / START TIME</small>________________ / ________</div></div><div class="orientation">NOSE / FRONT OF TRAILER ↓</div><div class="trailer-shell"><div class="side-labels"><span>LEFT SIDE — ODD POSITIONS</span><span>RIGHT SIDE — EVEN POSITIONS</span></div><div class="slot-grid">${slots.slice(0,4).join('')}<div class="bulkhead">INSULATED BULKHEAD / BUN — FREEZER ABOVE | COOLER + DRY BELOW</div>${slots.slice(4).join('')}</div>${handHtml}<div class="rear">REAR DOORS / LOAD FROM THIS END</div></div><div class="totals"><b>COMPARTMENT TOTALS</b><table><tr><th>AREA</th><th>PALLETS</th><th>WEIGHT</th><th>QTY</th></tr>${Object.entries(tot).map(([k,v])=>`<tr><td>${k.toUpperCase()}</td><td>${v.p}</td><td>${v.w.toLocaleString()}</td><td>${v.q}</td></tr>`).join('')}</table></div><div class="verification"><span><span class="check"></span> PALLETS ${job.pallets.length}</span><span><span class="check"></span> HAND STACK ${hand.length}</span><span><span class="check"></span> STRAPS ${straps}</span><span><span class="check"></span> LOAD LOCKS ${locks}</span></div></section>`;
}
const mapPageWithoutBarcodes=mapPage;
mapPage=job=>{
  const b=job.barcodes||{};
  const row=`<div class="barcode-row">${barcodeBox('DRY LOADING ASSIGNMENT',b.dry)}${barcodeBox('COOLER LOADING ASSIGNMENT',b.cooler)}${barcodeBox('FROZEN LOADING ASSIGNMENT',b.frozen)}</div>`;
  return mapPageWithoutBarcodes(job).replace('<div class="verification">',`${row}<div class="verification">`);
};
function labelPage(job){const labels=[...job.pallets,...Array(Math.max(0,28-job.pallets.length)).fill(null)].slice(0,28);return`<section class="print-sheet"><div class="print-header"><img src="assets/pfg-logo-white.png"><h1>PALLET LABEL RECORD</h1><div class="meta">ROUTE ${escapeHtml(job.route)}<br>${escapeHtml(job.date)}</div></div><p style="font-size:8pt;color:#e31b23;font-weight:800">PRINT AT ACTUAL SIZE (100%) — EACH SPACE IS 2 × 1 INCH</p><div class="label-grid">${labels.map((p,i)=>`<div class="label-space"><strong>${p?`${p.code} | SOURCE POSITION ${p.pos}`:`EXTRA LABEL SPACE ${i+1}`}</strong><span>APPLY 2 × 1 LABEL HERE</span></div>`).join('')}</div><div class="label-footer"><span class="check"></span> ALL ${job.pallets.length} LABELS ATTACHED &nbsp;&nbsp; Loader: __________________ &nbsp;&nbsp; Time: __________</div></section>`}
let preparedPdf=null;
async function preparePreview(){
  const jobs=state.jobs.filter(j=>j.status!=='reading');
  if(!jobs.length){alert('Add and review at least one load map first.');return;}
  $('#previewScreen').classList.remove('hidden');
  $('#previewPages').innerHTML='<div class="preview-loading">Preparing printable pages…</div>';
  $('#previewStatus').textContent='Preparing…';
  $('#sharePdf').disabled=true;$('#sharePdf').textContent='Preparing PDF…';
  $('#printArea').innerHTML=jobs.map(j=>mapPage(j)+labelPage(j)).join('');
  preparedPdf=null;
  try{
    await document.fonts?.ready;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    document.querySelectorAll('#printArea .barcode').forEach(svg=>JsBarcode(svg,svg.dataset.value,{format:'CODE128',width:1.1,height:22,margin:0,fontSize:7,displayValue:true}));
    const pages=[...document.querySelectorAll('#printArea .print-sheet')];
    const pdf=new window.jspdf.jsPDF({orientation:'portrait',unit:'pt',format:'letter',compress:true});
    $('#previewPages').innerHTML='';
    for(let i=0;i<pages.length;i++){
      $('#previewStatus').textContent=`Page ${i+1} of ${pages.length}`;
      const canvas=await html2canvas(pages[i],{scale:1.25,useCORS:true,backgroundColor:'#ffffff',logging:false});
      const image=canvas.toDataURL('image/jpeg',0.88);
      const preview=document.createElement('img');preview.src=image;preview.alt=`PDF page ${i+1}`;$('#previewPages').appendChild(preview);
      if(i)pdf.addPage('letter','portrait');
      pdf.addImage(image,'JPEG',0,0,612,792,undefined,'FAST');
      canvas.width=1;canvas.height=1;
    }
    preparedPdf=pdf.output('blob');
    $('#previewStatus').textContent=`${pages.length} pages ready`;
    $('#sharePdf').disabled=false;$('#sharePdf').textContent='Share PDF';
  }catch(error){
    console.error(error);$('#previewStatus').textContent='Preview failed';
    $('#previewPages').innerHTML='<div class="preview-loading">The PDF preview could not be created. Check your internet connection and try again.</div>';
    $('#sharePdf').textContent='Share unavailable';
  }
}
$('#printButton').addEventListener('click',preparePreview);
$('#closePreview').addEventListener('click',()=>$('#previewScreen').classList.add('hidden'));
$('#printPdf').addEventListener('click',()=>{void $('#printArea').offsetHeight;window.print();});
$('#sharePdf').addEventListener('click',async()=>{
  if(!preparedPdf)return;
  const jobs=state.jobs.filter(j=>j.status!=='reading');
  const name=jobs.length===1?`Route_${jobs[0].route}_Load_Map.pdf`:`PFG_Load_Maps_${jobs.length}_Routes.pdf`;
  const file=new File([preparedPdf],name,{type:'application/pdf'});
  if(navigator.share&&navigator.canShare?.({files:[file]})){
    try{await navigator.share({files:[file],title:'PFG Load Maps'});}catch(error){if(error.name!=='AbortError')console.error(error);}
  }else{
    const link=document.createElement('a');link.href=URL.createObjectURL(preparedPdf);link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
  }
});
$('#installButton').addEventListener('click',()=>$('#installHelp').showModal());$('.dialog-close').addEventListener('click',()=>$('#installHelp').close());
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js');

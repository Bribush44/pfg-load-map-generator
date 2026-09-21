const CAPACITY={28:{standard:12,pinwheel:13},36:{standard:16,pinwheel:17},48:{standard:22,pinwheel:23},53:{standard:24,pinwheel:26}};
const SPECIAL_CODES=new Set(['40','42','53','71','81']);
const usesPalletSpace=p=>!SPECIAL_CODES.has(String(p?.specialCode||''))||Number(p?.weight)>200;
const state={jobs:[],dispatchRoutes:new Map(),dispatchLoaded:false,dispatchName:'',dispatchPhotoCount:0};
const $=s=>document.querySelector(s);
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const routeKey=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const readAsDataUrl=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('The dispatch file could not be opened.'));reader.readAsDataURL(file);});

function applyDispatchTrailer(job){
  const match=state.dispatchRoutes.get(routeKey(job.route));
  if(match){
    job.trailer=Number(match.trailer);job.trailerSource='dispatch';job.dispatchMatch=match;
  }else{
    job.trailer=null;job.trailerSource='missing';job.dispatchMatch=null;
  }
}

function mergeDispatchRows(rows,{replace=false}={}){
  if(replace)state.dispatchRoutes=new Map();
  (rows||[]).forEach(row=>{if(routeKey(row.route)&&[28,36,48,53].includes(Number(row.trailer)))state.dispatchRoutes.set(routeKey(row.route),row);});
  state.dispatchLoaded=state.dispatchRoutes.size>0;
  state.jobs.filter(job=>job.status!=='reading').forEach(applyDispatchTrailer);
}

async function loadDispatch(file){
  if(!file)return;
  const status=$('#dispatchStatus');status.className='dispatch-status loading';status.textContent=`Reading ${file.name}…`;
  try{
    const dataUrl=await readAsDataUrl(file),base64=String(dataUrl).split(',')[1]||'';
    const response=await fetch('/api/dispatch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({file:base64,name:file.name})});
    const result=await response.json().catch(()=>({error:`Dispatch service returned ${response.status}`}));
    if(!response.ok)throw new Error(result.error||'Dispatch could not be read.');
    mergeDispatchRows(result.routes,{replace:true});state.dispatchName=file.name;state.dispatchPhotoCount=0;
    status.className='dispatch-status ready';status.innerHTML=`<strong>${escapeHtml(file.name)}</strong><span>${result.count} routes ready · ${result.sheets} day sheets read</span>${result.warnings?.length?`<small>${escapeHtml(result.warnings.join(' · '))}</small>`:''}`;
    renderQueue();renderReviews();
  }catch(error){
    state.dispatchRoutes=new Map();state.dispatchLoaded=false;state.dispatchName='';status.className='dispatch-status error';status.textContent=error.message||'Dispatch could not be read.';
  }
}

async function loadDispatchPhotos(files){
  if(!files.length)return;
  const status=$('#dispatchStatus'),warnings=[];let added=0;
  status.className='dispatch-status loading';
  try{
    for(let i=0;i<files.length;i++){
      status.textContent=`Reading dispatch photo ${i+1} of ${files.length}…`;
      const response=await fetch('/api/dispatch-photo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:await imageData(files[i])})});
      const result=await response.json().catch(()=>({error:`Photo service returned ${response.status}`}));
      if(!response.ok)throw new Error(result.error||`Dispatch photo ${i+1} could not be read.`);
      mergeDispatchRows(result.routes);added+=result.routes?.length||0;warnings.push(...(result.review_notes||[]));state.dispatchPhotoCount++;
    }
    state.dispatchName=`${state.dispatchPhotoCount} dispatch photo${state.dispatchPhotoCount===1?'':'s'}`;
    status.className='dispatch-status ready';status.innerHTML=`<strong>${escapeHtml(state.dispatchName)}</strong><span>${state.dispatchRoutes.size} routes ready · ${added} rows read in this batch</span>${warnings.length?`<small>Review: ${escapeHtml(warnings.join(' · '))}</small>`:''}`;
    renderQueue();renderReviews();
  }catch(error){status.className='dispatch-status error';status.textContent=error.message||'The dispatch photos could not be read.';}
}
async function imageData(file){
  const url=URL.createObjectURL(file),image=new Image();
  try{
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('This iPhone photo could not be opened. Try taking the picture again.'));image.src=url;});
    const max=2000,scale=Math.min(1,max/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
    const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
    const data=canvas.toDataURL('image/jpeg',0.88);if(data==='data:,')throw new Error('The photo could not be prepared. Try taking it again.');return data;
  }finally{URL.revokeObjectURL(url);}
}

async function analyzeWithAI(file){
  const response=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:await imageData(file),trailer:0})});
  const result=await response.json().catch(()=>({error:`Analysis service returned ${response.status}`}));if(!response.ok)throw new Error(result.error||'AI analysis failed');return result;
}

function parseText(text,file,index){
  const clean=text.replace(/[|]/g,' ').replace(/\r/g,'');
  const route=(clean.match(/Route\s*#?\s*[:.-]?\s*([A-Z0-9]+)/i)||[])[1]||`ROUTE-${index+1}`;
  const date=(clean.match(/\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\b/)||[])[1]||new Date().toLocaleDateString();
  const oppk=(clean.match(/\b(OPPK[A-Z0-9-]+)\b/i)||[])[1]||'';
  const door=(clean.match(/DockDr\s*\n?\s*(\d+)/i)||[])[1]||'25';
  const pallets=[];
  const rx=/\b(\d{1,2})\s+([FRD]\d{2})\s+(\d{1,3})\s+(\d{1,5})\s+(\d{1,4})\s+([0-9 -]{1,7})/gi;
  let m; while((m=rx.exec(clean))){pallets.push({pos:+m[1],code:m[2].toUpperCase(),cube:+m[3],weight:+m[4],qty:+m[5],stops:m[6].trim().replace(/\s+/g,'-'),specialCode:''});}
  return{id:crypto.randomUUID(),fileName:file.name,route,date,oppk,door,trailer:null,trailerSource:'missing',pallets,raw:text,status:'ready'};
}

async function addFiles(files){
  if(!files.length)return;
  if(!state.dispatchLoaded){alert('Upload the nightly dispatch Excel file or dispatch photos before adding load maps.');return;}
  for(const file of files){
    const temp={id:crypto.randomUUID(),fileName:file.name,status:'reading',progress:0,preview:URL.createObjectURL(file)};
    state.jobs.push(temp);renderQueue();
    try{
      const result=await analyzeWithAI(file);
      Object.assign(temp,{...result,id:temp.id,fileName:file.name,trailer:null,preview:temp.preview,status:'ready'});
    }catch(e){Object.assign(temp,parseText('',file,state.jobs.indexOf(temp)),{id:temp.id,preview:temp.preview,status:'review',error:e.message||'Automatic reading failed. Enter the values below.',barcodes:{dry:'',cooler:'',frozen:''}});}
    applyDispatchTrailer(temp);
    renderQueue();renderReviews();
  }
  if(state.jobs.filter(j=>j.status!=='reading').every(j=>j.trailerSource==='dispatch'))await preparePreview();
}

function renderQueue(){
  $('#queue').innerHTML=state.jobs.map(j=>{const palletSpaces=(j.pallets||[]).filter(usesPalletSpace).length,special=(j.pallets||[]).filter(p=>SPECIAL_CODES.has(String(p.specialCode||''))).length;return`<div class="queue-item"><img src="${j.preview||''}" alt=""><div><strong>${escapeHtml(j.fileName)}</strong><small>${j.status==='reading'?'OpenAI is reading the sheet…':`Ready to review · ${palletSpaces} pallet spaces${special?` · ${special} special items`:''}${j.trailer?` · ${j.trailer} ft`:''}`}</small>${j.trailerSource==='dispatch'?`<small class="match-ok">Dispatch match: ${escapeHtml(j.route)} → ${j.trailer} ft</small>`:''}${j.trailerSource==='missing'?`<small class="match-missing">Route ${escapeHtml(j.route)} was not found in the dispatch — correct the Route # or add another dispatch photo</small>`:''}${j.error?`<small class="tag">${escapeHtml(j.error)}</small>`:''}${j.status==='reading'?'<div class="progress"><i style="width:65%"></i></div>':''}</div></div>`}).join('');
}

const PALLET_NUMERIC_FIELDS=new Set(['pos','cube','weight','qty']);
function palletEditor(job){
  const rows=(job.pallets||[]).map((p,row)=>`<div class="pallet-row">
    <div class="pallet-row-number">PALLET ${row+1}</div>
    <label>Position<input inputmode="numeric" data-id="${job.id}" data-row="${row}" data-pallet-key="pos" value="${escapeHtml(p.pos)}" aria-label="Pallet ${row+1} position"></label>
    <label>Pallet code<input autocapitalize="characters" data-id="${job.id}" data-row="${row}" data-pallet-key="code" value="${escapeHtml(p.code)}" placeholder="D01" aria-label="Pallet ${row+1} code"></label>
    <label>Cube<input inputmode="numeric" data-id="${job.id}" data-row="${row}" data-pallet-key="cube" value="${escapeHtml(p.cube)}" aria-label="Pallet ${row+1} cube"></label>
    <label>Weight (lb)<input inputmode="numeric" data-id="${job.id}" data-row="${row}" data-pallet-key="weight" value="${escapeHtml(p.weight)}" aria-label="Pallet ${row+1} weight"></label>
    <label>Quantity<input inputmode="numeric" data-id="${job.id}" data-row="${row}" data-pallet-key="qty" value="${escapeHtml(p.qty)}" aria-label="Pallet ${row+1} quantity"></label>
    <label>Stops<input data-id="${job.id}" data-row="${row}" data-pallet-key="stops" value="${escapeHtml(p.stops)}" placeholder="1-5" aria-label="Pallet ${row+1} stops"></label>
    <label>Special item<select data-id="${job.id}" data-row="${row}" data-pallet-key="specialCode" aria-label="Pallet ${row+1} special item">
      <option value="" ${!p.specialCode?'selected':''}>None</option><option value="40" ${String(p.specialCode)==='40'?'selected':''}>40 · Dry PIR</option><option value="42" ${String(p.specialCode)==='42'?'selected':''}>42 · Chemicals</option><option value="53" ${String(p.specialCode)==='53'?'selected':''}>53 · Ice Cream</option><option value="71" ${String(p.specialCode)==='71'?'selected':''}>71 · Freezer PIR</option><option value="81" ${String(p.specialCode)==='81'?'selected':''}>81 · Seafood</option>
    </select></label>
    <button type="button" class="remove-pallet" data-action="remove-pallet" data-id="${job.id}" data-row="${row}" aria-label="Remove pallet ${row+1}">Remove</button>
  </div>`).join('');
  return`<div class="full pallet-editor"><div class="pallet-editor-heading"><div><strong>PALLET DETAILS</strong><small>Edit anything the camera read incorrectly.</small></div><button type="button" class="add-pallet" data-action="add-pallet" data-id="${job.id}">+ Add pallet</button></div><div class="pallet-list">${rows||'<div class="empty-pallets">No pallets were identified. Tap “Add pallet” to enter them manually.</div>'}</div></div>`;
}

function renderReviews(){
  const ready=state.jobs.filter(j=>j.status!=='reading');
  $('#reviewSection').classList.toggle('hidden',!ready.length);$('#finishSection').classList.toggle('hidden',!ready.length);
  $('#routeCount').textContent=`${ready.length} route${ready.length===1?'':'s'}`;
  $('#reviews').innerHTML=ready.map(j=>{j.pallets=j.pallets||[];const palletSpaces=j.pallets.filter(usesPalletSpace).length,special=j.pallets.filter(p=>SPECIAL_CODES.has(String(p.specialCode||''))).length;return`<details class="route-review" open><summary class="route-summary"><span>${escapeHtml(j.route)}</span><span>${palletSpaces} pallet spaces${special?` + ${special} special`:''}</span></summary><div class="route-fields">
    <label>Route #<input data-id="${j.id}" data-key="route" value="${escapeHtml(j.route)}"></label><label>Door<input data-id="${j.id}" data-key="door" value="${escapeHtml(j.door)}"></label>
    <label>Trailer size<div class="trailer-readout ${j.trailerSource==='dispatch'?'matched':'missing'}">${j.trailerSource==='dispatch'?`${j.trailer} ft`:'NO DISPATCH MATCH'}</div><small class="trailer-source ${j.trailerSource==='dispatch'?'matched':'missing'}">${j.trailerSource==='dispatch'?`Matched from ${escapeHtml(j.dispatchMatch?.sheet||'dispatch')} · ${escapeHtml(j.dispatchMatch?.trailerNumber||'')}`:'Correct the Route # or add another dispatch photo'}</small></label>
    <label>OPPK<input data-id="${j.id}" data-key="oppk" value="${escapeHtml(j.oppk)}"></label><label>Date<input data-id="${j.id}" data-key="date" value="${escapeHtml(j.date)}"></label>
    <label>Dry barcode<input data-id="${j.id}" data-key="barcode-dry" value="${escapeHtml(j.barcodes?.dry||'')}"></label><label>Cooler barcode<input data-id="${j.id}" data-key="barcode-cooler" value="${escapeHtml(j.barcodes?.cooler||'')}"></label>
    <label>Frozen barcode<input data-id="${j.id}" data-key="barcode-frozen" value="${escapeHtml(j.barcodes?.frozen||'')}"></label><span></span>
    ${j.review_notes?.length?`<div class="full tag"><b>AI REVIEW:</b> ${escapeHtml(j.review_notes.join(' · '))}</div>`:''}
    ${palletEditor(j)}
  </div></details>`}).join('');
}

document.addEventListener('input',e=>{const id=e.target.dataset.id;if(!id)return;const job=state.jobs.find(j=>j.id===id);if(!job)return;const palletKey=e.target.dataset.palletKey;if(palletKey){const pallet=job.pallets?.[Number(e.target.dataset.row)];if(!pallet)return;let value=e.target.value;if(PALLET_NUMERIC_FIELDS.has(palletKey))value=value===''?'':Number(value);if(palletKey==='code')value=value.toUpperCase().replace(/\s/g,'');pallet[palletKey]=value;return;}const key=e.target.dataset.key;if(key?.startsWith('barcode-')){job.barcodes=job.barcodes||{};job.barcodes[key.slice(8)]=e.target.value.trim();}else if(key)job[key]=e.target.value;});
document.addEventListener('change',e=>{const id=e.target.dataset.id,key=e.target.dataset.key;if(!id||key!=='route')return;const job=state.jobs.find(j=>j.id===id);applyDispatchTrailer(job);renderQueue();renderReviews();});
document.addEventListener('click',e=>{const button=e.target.closest('[data-action]');if(!button)return;const job=state.jobs.find(j=>j.id===button.dataset.id);if(!job)return;if(button.dataset.action==='add-pallet'){job.pallets=job.pallets||[];job.pallets.push({pos:'',code:'',cube:'',weight:'',qty:'',stops:'',specialCode:''});}else if(button.dataset.action==='remove-pallet'){job.pallets.splice(Number(button.dataset.row),1);}renderQueue();renderReviews();});
$('#dispatchInput').addEventListener('change',e=>loadDispatch(e.target.files?.[0]));
$('#dispatchCameraInput').addEventListener('change',async e=>{await loadDispatchPhotos([...e.target.files]);e.target.value='';});
$('#dispatchPhotosInput').addEventListener('change',async e=>{await loadDispatchPhotos([...e.target.files]);e.target.value='';});
$('#cameraInput').addEventListener('change',e=>addFiles([...e.target.files]));$('#batchInput').addEventListener('change',e=>addFiles([...e.target.files]));
$('#clearButton').addEventListener('click',()=>{state.jobs.forEach(j=>j.preview&&URL.revokeObjectURL(j.preview));state.jobs=[];renderQueue();renderReviews();$('#printArea').innerHTML='';});

function zone(code){return code[0]==='F'?'freezer':code[0]==='R'?'cooler':'dry'}
function summarize(job){const out={freezer:{p:0,w:0,q:0},cooler:{p:0,w:0,q:0},dry:{p:0,w:0,q:0}};job.pallets.forEach(p=>{const z=out[zone(p.code)];z.p++;z.w+=p.weight;z.q+=p.qty});return out;}
function restraints(p){return p.weight>1200?(p.code[0]==='F'?'LOAD LOCK':'STRAP'):'';}
function isPinwheel(p,job){return job.trailer===28&&/^R0[1-4]$/.test(p.code)}
function barcodeBox(label,value){return`<div class="barcode-box">${label}${value?`<svg class="barcode" data-value="${escapeHtml(value)}"></svg>`:'<span class="barcode-missing">REVIEW VALUE</span>'}</div>`}

function mapPage(job){
  const cap=CAPACITY[job.trailer].pinwheel,layoutSlots=cap+(cap%2),sorted=[...job.pallets].sort((a,b)=>a.pos-b.pos),main=sorted.filter(p=>p.pos<=cap),hand=sorted.filter(p=>p.pos>cap),positions=Array.from({length:layoutSlots},(_,i)=>i+1),tot=summarize(job);
  const slots=positions.map(pos=>{if(pos>cap)return`<div class="slot special"><b>POSITION ${pos}</b><span>HAND STACK AREA — PARTIAL SPACE</span></div>`;const p=main.find(x=>x.pos===pos);if(!p)return`<div class="slot special"><b>POSITION ${pos}</b><span>DOOR SPACE / FREEZER PIR</span></div>`;const r=restraints(p);return`<div class="slot ${zone(p.code)}"><span class="slot-num">${pos}</span><div><span class="slot-code">${p.code}</span><span class="slot-detail">${p.weight.toLocaleString()} lb · Qty ${p.qty} · Stops ${escapeHtml(p.stops)}</span></div><div>${isPinwheel(p,job)?'<span class="tag">P · ROTATE</span><br>':''}${r?`<span class="check"></span><span class="tag">${r}</span><br>`:''}<span class="check"></span>LOAD</div></div>`}).join('');
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
let preparedPdf=null,preparedPdfUrl='';
function jobReviewErrors(job){
  const errors=[];
  const positions=new Set();
  if(!String(job.route||'').trim())errors.push('Route #');
  if(!String(job.door||'').trim())errors.push('Door');
  if(!String(job.oppk||'').trim())errors.push('OPPK');
  if(!String(job.date||'').trim())errors.push('Date');
  (job.pallets||[]).forEach((p,index)=>{
    const missing=[];
    if(!Number.isInteger(Number(p.pos))||Number(p.pos)<1)missing.push('position');
    else if(positions.has(Number(p.pos)))missing.push('duplicate position');
    else positions.add(Number(p.pos));
    if(!/^[FRD]\d{2}$/i.test(String(p.code||'')))missing.push('pallet code');
    if(!Number.isFinite(Number(p.cube))||Number(p.cube)<0)missing.push('cube');
    if(!Number.isFinite(Number(p.weight))||Number(p.weight)<=0)missing.push('weight');
    if(!Number.isFinite(Number(p.qty))||Number(p.qty)<=0)missing.push('quantity');
    if(!String(p.stops||'').trim())missing.push('stops');
    if(missing.length)errors.push(`Pallet ${index+1}: ${missing.join(', ')}`);
  });
  if(!(job.pallets||[]).length)errors.push('at least one pallet');
  return errors;
}
async function preparePreview(){
  const jobs=state.jobs.filter(j=>j.status!=='reading');
  if(!jobs.length){alert('Add and review at least one load map first.');return;}
  const unmatched=jobs.filter(j=>j.trailerSource!=='dispatch'||![28,36,48,53].includes(Number(j.trailer)));
  if(unmatched.length){alert(`PDF not created. No dispatch trailer match for: ${unmatched.map(j=>j.route||j.fileName).join(', ')}. Correct the Route # or add the missing dispatch photo.`);return;}
  const incomplete=jobs.map(job=>({job,errors:jobReviewErrors(job)})).filter(item=>item.errors.length);
  if(incomplete.length){alert(`Please correct the listed review information before creating the PDF:\n\n${incomplete.map(({job,errors})=>`${job.route||job.fileName}: ${errors.slice(0,6).join('; ')}${errors.length>6?`; and ${errors.length-6} more`:''}`).join('\n')}`);return;}
  $('#previewScreen').classList.remove('hidden');
  $('#previewPages').innerHTML='<div class="preview-loading">Preparing printable pages…</div>';
  $('#previewStatus').textContent='Preparing…';
  $('#sharePdf').disabled=true;$('#sharePdf').textContent='Generating PDF…';$('#printPdf').disabled=true;
  preparedPdf=null;
  try{
    const response=await fetch('/api/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobs})});
    if(!response.ok){const problem=await response.json().catch(()=>({}));throw new Error(problem.error||`PDF service returned ${response.status}`);}
    preparedPdf=await response.blob();if(preparedPdfUrl)URL.revokeObjectURL(preparedPdfUrl);preparedPdfUrl=URL.createObjectURL(preparedPdf);
    $('#previewPages').innerHTML=`<iframe class="pdf-preview-frame" title="Generated load map PDF" src="${preparedPdfUrl}"></iframe>`;
    const pageCount=jobs.reduce((total,job)=>total+1+Math.max(1,Math.ceil((job.pallets?.length||0)/18)),0);$('#previewStatus').textContent=`${pageCount} pages ready`;$('#sharePdf').disabled=false;$('#sharePdf').textContent='Share PDF';$('#printPdf').disabled=false;$('#printPdf').textContent='Open / Print PDF';
  }catch(error){
    console.error(error);$('#previewStatus').textContent='PDF failed';$('#previewPages').innerHTML=`<div class="preview-loading">${escapeHtml(error.message||'The PDF could not be generated.')}</div>`;$('#sharePdf').textContent='Share unavailable';
  }
}
$('#printButton').addEventListener('click',preparePreview);
$('#closePreview').addEventListener('click',()=>$('#previewScreen').classList.add('hidden'));
$('#printPdf').addEventListener('click',()=>{if(preparedPdfUrl)window.open(preparedPdfUrl,'_blank');});
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

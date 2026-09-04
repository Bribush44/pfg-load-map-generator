import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';
import fs from 'node:fs';
import path from 'node:path';

const CAPACITY={28:13,36:17,48:23,53:26};
const colors={freezer:'#dceeff',cooler:'#dff3ed',dry:'#fff0d6',special:'#ffe1e1'};
const safe=v=>String(v??'').replace(/[^\x20-\x7E]/g,' ').slice(0,80);
const zone=c=>c?.[0]==='F'?'freezer':c?.[0]==='R'?'cooler':'dry';
const restraint=p=>p.weight>1200?(p.code?.[0]==='F'?'LOAD LOCK':'STRAP'):'';
const check=(doc,x,y,label)=>{doc.rect(x,y,8,8).stroke('#111');doc.fontSize(6).fillColor('#111').text(label,x+12,y+1);};
const box=(doc,x,y,w,label,value)=>{doc.roundedRect(x,y,w,34,4).stroke('#222');doc.fontSize(5).fillColor('#555').text(label,x+6,y+4);doc.font('Helvetica-Bold').fontSize(11).fillColor('#111').text(safe(value),x+6,y+13,{width:w-12});doc.font('Helvetica');};

async function barcode(doc,label,value,x,y,w){
  doc.rect(x,y,w,45).stroke('#aaa').font('Helvetica-Bold').fontSize(5).fillColor('#111').text(label,x+4,y+3,{width:w-8,align:'center'});
  if(!value){doc.fillColor('#c00').text('REVIEW VALUE',x+4,y+20,{width:w-8,align:'center'});return;}
  try{const png=await bwipjs.toBuffer({bcid:'code128',text:safe(value),scale:2,height:7,includetext:true,textxalign:'center'});doc.image(png,x+8,y+12,{fit:[w-16,29],align:'center'});}catch{doc.fillColor('#c00').text(safe(value),x+4,y+20,{width:w-8,align:'center'});}
}

function header(doc,job,title){
  doc.rect(20,18,572,46).fill('#111');
  const logo=path.join(process.cwd(),'assets','pfg-logo-white.png');if(fs.existsSync(logo))doc.image(logo,28,29,{fit:[92,22]});
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#fff').text(title,130,32,{width:300,align:'center'});
  doc.font('Helvetica').fontSize(7).text(`OPPK: ${safe(job.oppk)}\nDATE: ${safe(job.date)}`,445,27,{width:135,align:'right'});
}

async function loadMapPage(doc,job){
  header(doc,job,'TRAILER LOAD MAP');
  box(doc,20,72,80,'DOOR',job.door);box(doc,106,72,105,'ROUTE',job.route);box(doc,217,72,78,'TRAILER',`${job.trailer} FT`);box(doc,301,72,291,'LOADER SIGN-OFF / START TIME','________________ / ________');
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#111').text('NOSE / FRONT OF TRAILER',20,112,{width:572,align:'center'});
  doc.fontSize(6).text('LEFT SIDE - ODD POSITIONS',26,125,{width:272,align:'center'}).text('RIGHT SIDE - EVEN POSITIONS',314,125,{width:272,align:'center'});
  const cap=CAPACITY[job.trailer]||13,layout=cap+(cap%2),rows=Math.ceil(layout/2),rowH=Math.min(34,300/rows),top=138,w=274,gap=14;
  const pallets=[...(job.pallets||[])].sort((a,b)=>a.pos-b.pos);let main,hand;
  if(Number(job.trailer)===53){
    const onboard=pallets.slice(0,cap),fixed=onboard.filter(p=>p.pos<=cap).map(p=>({...p,_slot:p.pos,_source:p.pos})),overflow=onboard.filter(p=>p.pos>cap),used=new Set(fixed.map(p=>p._slot));
    const open=Array.from({length:cap},(_,i)=>i+1).filter(pos=>!used.has(pos));main=[...fixed];
    overflow.forEach(p=>{let choices=open.filter(pos=>pos%2===p.pos%2);if(p.code?.[0]==='F')choices=choices.sort((a,b)=>a-b);else choices=choices.sort((a,b)=>b-a);const slot=(choices[0]??open[0]);if(slot){main.push({...p,_slot:slot,_source:p.pos});open.splice(open.indexOf(slot),1);}});hand=pallets.slice(cap);
  }else{main=pallets.filter(p=>p.pos<=cap).map(p=>({...p,_slot:p.pos,_source:p.pos}));hand=pallets.filter(p=>p.pos>cap);}
  const freezerEnd=Math.max(0,...main.filter(p=>p.code?.[0]==='F').map(p=>p._slot)),bulkRows=Math.ceil(freezerEnd/2);
  for(let row=0;row<rows;row++)for(let side=0;side<2;side++){
    const pos=row*2+side+1,x=22+side*(w+gap),y=top+row*rowH+(row>=bulkRows?14:0),p=main.find(v=>v._slot===pos),partial=pos>cap,z=p?zone(p.code):'special';
    doc.roundedRect(x,y,w,rowH-3,4).fillAndStroke(colors[z],'#555');doc.fillColor('#111').font('Helvetica-Bold').fontSize(8).text(String(pos),x+6,y+6,{width:18});
    if(partial){doc.fontSize(7).text('HAND STACK AREA - PARTIAL SPACE',x+28,y+8,{width:w-34});continue;}
    if(!p){const blank=Number(job.trailer)===53&&pos>24?'AVAILABLE PINWHEEL SPACE':pos<=freezerEnd?'DOOR SPACE / FREEZER PIR':'DOOR SPACE';doc.fontSize(7).text(blank,x+28,y+8,{width:w-34});continue;}
    doc.fontSize(11).text(safe(p.code),x+28,y+3,{width:45});doc.font('Helvetica').fontSize(6).text(`${Number(p.weight).toLocaleString()} lb | Qty ${p.qty} | Stops ${safe(p.stops)}${p._source!==pos?` | Src ${p._source}`:''}`,x+75,y+5,{width:125});
    const flags=[p.code?.[0]!=='F'&&pos%2===1?'P - ROTATE':'',restraint(p)].filter(Boolean).join(' / ');doc.font('Helvetica-Bold').fontSize(5).fillColor('#c00').text(flags,x+198,y+3,{width:70,align:'right'});check(doc,x+202,y+rowH-14,'LOAD');
  }
  const bulkY=top+bulkRows*rowH;doc.rect(22,bulkY,562,11).fill('#111');doc.font('Helvetica-Bold').fontSize(5).fillColor('#fff').text('INSULATED BULKHEAD / BUN - FREEZER ABOVE | COOLER + DRY BELOW',24,bulkY+3,{width:558,align:'center'});
  let y=top+rows*rowH+18;
  if(hand.length){doc.roundedRect(22,y,562,42,4).fillAndStroke('#fff6f6','#c00');doc.font('Helvetica-Bold').fontSize(7).fillColor('#c00').text('HAND STACK ON BACK - OVER CAPACITY',28,y+4);doc.font('Helvetica').fontSize(6).fillColor('#111').text(hand.map(p=>`${safe(p.code)} ${p.weight}lb Qty ${p.qty}${p.weight>200?' REVIEW':''}`).join('   |   '),28,y+15,{width:550,height:22});y+=48;}
  const totals={freezer:{p:0,w:0,q:0},cooler:{p:0,w:0,q:0},dry:{p:0,w:0,q:0}};pallets.forEach(p=>{const z=totals[zone(p.code)];z.p++;z.w+=Number(p.weight)||0;z.q+=Number(p.qty)||0;});
  doc.roundedRect(22,y,562,55,4).stroke('#555');doc.font('Helvetica-Bold').fontSize(7).fillColor('#111').text('COMPARTMENT TOTALS',28,y+4);let ty=y+16;Object.entries(totals).forEach(([k,v])=>{doc.fontSize(6).text(`${k.toUpperCase()}:  ${v.p} pallets   |   ${v.w.toLocaleString()} lb   |   Qty ${v.q}`,28,ty);ty+=10;});y+=61;
  const bw=180;await barcode(doc,'DRY LOADING ASSIGNMENT',job.barcodes?.dry,22,y,bw);await barcode(doc,'COOLER LOADING ASSIGNMENT',job.barcodes?.cooler,216,y,bw);await barcode(doc,'FROZEN LOADING ASSIGNMENT',job.barcodes?.frozen,410,y,174);y+=52;
  const straps=pallets.filter(p=>restraint(p)==='STRAP').length,locks=pallets.filter(p=>restraint(p)==='LOAD LOCK').length;check(doc,24,y,`PALLETS ${pallets.length}`);check(doc,145,y,`HAND STACK ${hand.length}`);check(doc,292,y,`STRAPS ${straps}`);check(doc,430,y,`LOAD LOCKS ${locks}`);
}

function labelPage(doc,job){
  header(doc,job,'PALLET LABEL RECORD');doc.font('Helvetica-Bold').fontSize(7).fillColor('#c00').text('PRINT AT ACTUAL SIZE (100%) - EACH SPACE IS 2 x 1 INCH',20,72,{width:572,align:'center'});
  const pallets=job.pallets||[];for(let i=0;i<28;i++){const col=i%4,row=Math.floor(i/4),x=18+col*144,y=88+row*72,p=pallets[i];doc.rect(x,y,144,72).stroke('#888');doc.font('Helvetica-Bold').fontSize(6).fillColor('#111').text(p?`${safe(p.code)} | SOURCE POSITION ${p.pos}`:`EXTRA LABEL SPACE ${i+1}`,x+5,y+5,{width:134});doc.font('Helvetica').fontSize(6).fillColor('#777').text('APPLY 2 x 1 LABEL HERE',x+5,y+32,{width:134,align:'center'});}
  check(doc,24,612,`ALL ${pallets.length} LABELS ATTACHED`);doc.fontSize(8).fillColor('#111').text('Loader: ____________________    Time: __________',210,612);
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'POST required'});
  const jobs=Array.isArray(req.body?.jobs)?req.body.jobs.slice(0,25):[];if(!jobs.length)return res.status(400).json({error:'No load maps supplied'});
  try{const doc=new PDFDocument({size:'LETTER',margin:0,autoFirstPage:false,compress:true}),chunks=[];doc.on('data',c=>chunks.push(c));const done=new Promise((resolve,reject)=>{doc.on('end',resolve);doc.on('error',reject);});for(const job of jobs){doc.addPage();await loadMapPage(doc,job);doc.addPage();labelPage(doc,job);}doc.end();await done;const pdf=Buffer.concat(chunks);res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`inline; filename="PFG_Load_Maps.pdf"`);res.setHeader('Cache-Control','no-store');return res.status(200).send(pdf);}catch(error){return res.status(500).json({error:error.message||'PDF generation failed'});}
}

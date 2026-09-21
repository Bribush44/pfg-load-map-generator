import PDFDocument from 'pdfkit';
import bwipjs from 'bwip-js';
import fs from 'node:fs';
import path from 'node:path';

const CAPACITY={28:13,36:17,48:23,53:26};
const STANDARD_CAPACITY={28:12,36:16,48:22,53:24};
const SPECIAL_CODES=new Set(['40','42','53','71','81']);
const colors={freezer:'#dceeff',cooler:'#dff3ed',dry:'#fff0d6',special:'#ffe1e1'};
const safe=v=>String(v??'').replace(/[^\x20-\x7E]/g,' ').slice(0,80);
const zone=c=>c?.[0]==='F'?'freezer':c?.[0]==='R'?'cooler':'dry';
const restraint=p=>p.weight>1200?(p.code?.[0]==='F'?'LOAD LOCK':'STRAP'):'';
const isSpecial=p=>SPECIAL_CODES.has(String(p?.specialCode||''));
const stopNumbers=value=>{const text=String(value||'').trim(),range=text.match(/^(\d+)\s*-\s*(\d+)$/);if(range){const from=+range[1],to=+range[2];if(to>=from&&to-from<=50)return new Set(Array.from({length:to-from+1},(_,i)=>from+i));}return new Set((text.match(/\d+/g)||[]).map(Number));};
const matchingFreezer=(special,pallets)=>{const wanted=stopNumbers(special.stops);return pallets.find(p=>p.code?.[0]==='F'&&[...stopNumbers(p.stops)].some(stop=>wanted.has(stop)));};
const specialPlacement=(item,pallets)=>{
  if(item.specialCode==='40')return'DRY PIR - BACK LEFT';
  if(item.specialCode==='42')return'CHEMICALS - BACK RIGHT';
  if(item.specialCode==='81')return'SEAFOOD - BACK LEFT - TAKE PHOTO / SEND TO GROUP CHAT';
  if(item.specialCode==='53'){const pos2=pallets.find(p=>p.pos===2);return pos2?`ICE CREAM - STACK ON ${safe(pos2.code)} PALLET IN POS 2`:'ICE CREAM - STACK IN POS 2 IN FRONT OF DOOR';}
  if(item.specialCode==='71'){const target=matchingFreezer(item,pallets);return target?`FREEZER PIR - STACK ON ${safe(target.code)} POS ${target.pos} - MATCH STOP ${safe(item.stops)}`:`FREEZER PIR - FIND FREEZER PALLET FOR STOP ${safe(item.stops)} - VERIFY`;}
  return'HAND STACK - VERIFY LOCATION';
};
const check=(doc,x,y,label)=>{doc.rect(x,y,10,10).lineWidth(1.2).stroke('#111');doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#111').text(label,x+14,y+1,{lineBreak:false});};
const box=(doc,x,y,w,label,value)=>{doc.roundedRect(x,y,w,34,4).stroke('#222');doc.fontSize(5).fillColor('#555').text(label,x+6,y+4);doc.font('Helvetica-Bold').fontSize(11).fillColor('#111').text(safe(value),x+6,y+13,{width:w-12});doc.font('Helvetica');};
const ACTION_COLORS={pinwheel:'#d97706',strap:'#b1121a',lock:'#1d4ed8'};
const actionBadge=(doc,x,y,w,h,label,color)=>{doc.save();doc.roundedRect(x,y,w,h,2).fill(color);const s=Math.min(7,h-2);doc.rect(x+3,y+(h-s)/2,s,s).fillAndStroke('#fff','#111');doc.font('Helvetica-Bold').fontSize(h<10?4.4:5.4).fillColor('#fff').text(label,x+13,y+(h<10?2:3),{width:w-16,align:'center',lineBreak:false});doc.restore();};
const miniCheck=(doc,x,y,label)=>{doc.rect(x,y,8,8).lineWidth(1).stroke('#111');doc.font('Helvetica-Bold').fontSize(5.2).fillColor('#111').text(label,x+11,y+1,{lineBreak:false});};
const actionPill=(doc,x,y,w,label,count,color)=>{doc.save();doc.roundedRect(x,y,w,11,3).fill(color);doc.font('Helvetica-Bold').fontSize(5.5).fillColor('#fff').text(`${label} ${count}`,x+4,y+3,{width:w-8,align:'center',lineBreak:false});doc.restore();};

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
  const cap=CAPACITY[job.trailer]||13,standard=STANDARD_CAPACITY[job.trailer]||12,layout=cap+(cap%2),rows=Math.ceil(layout/2),rowH=Math.min(42,380/rows),top=143,w=274,gap=14;
  const sourceRows=[...(job.pallets||[])].sort((a,b)=>a.pos-b.pos),specials=sourceRows.filter(isSpecial),pallets=sourceRows.filter(p=>!isSpecial(p)||Number(p.weight)>200),needsPinwheel=pallets.length>standard;let main,hand;
  if(Number(job.trailer)===53){
    const onboard=pallets.slice(0,cap),fixed=onboard.filter(p=>p.pos<=cap).map(p=>({...p,_slot:p.pos,_source:p.pos})),overflow=onboard.filter(p=>p.pos>cap),used=new Set(fixed.map(p=>p._slot));
    const open=Array.from({length:cap},(_,i)=>i+1).filter(pos=>!used.has(pos));main=[...fixed];
    overflow.forEach(p=>{let choices=open.filter(pos=>pos%2===p.pos%2);if(p.code?.[0]==='F')choices=choices.sort((a,b)=>a-b);else choices=choices.sort((a,b)=>b-a);const slot=(choices[0]??open[0]);if(slot){main.push({...p,_slot:slot,_source:p.pos});open.splice(open.indexOf(slot),1);}});hand=pallets.slice(cap);
  }else{main=pallets.filter(p=>p.pos<=cap).map(p=>({...p,_slot:p.pos,_source:p.pos}));hand=pallets.filter(p=>p.pos>cap);}
  const freezerEnd=Math.max(0,...main.filter(p=>p.code?.[0]==='F').map(p=>p._slot)),bulkRows=Math.ceil(freezerEnd/2),iceCreamInPos2=specials.some(p=>p.specialCode==='53')&&!main.some(p=>p._slot===2),doorSpaces=Array.from({length:cap},(_,i)=>i+1).filter(pos=>!main.some(p=>p._slot===pos)&&!(iceCreamInPos2&&pos===2)&&!(Number(job.trailer)===53&&pos>24));
  const pinwheelRequired=p=>needsPinwheel&&p.code?.[0]!=='F'&&p._slot%2===1;
  const pinwheels=main.filter(pinwheelRequired).length,straps=pallets.filter(p=>restraint(p)==='STRAP').length,locks=pallets.filter(p=>restraint(p)==='LOAD LOCK').length+doorSpaces.length;
  header(doc,job,'TRAILER LOAD MAP');
  box(doc,20,72,80,'DOOR',job.door);box(doc,106,72,105,'ROUTE',job.route);box(doc,217,72,78,'TRAILER',`${job.trailer} FT`);box(doc,301,72,291,'LOADER SIGN-OFF / START TIME','________________ / ________');
  doc.font('Helvetica-Bold').fontSize(7).fillColor('#111').text('NOSE / FRONT OF TRAILER',20,108,{width:572,align:'center'});
  doc.fontSize(5.5).text('REQUIRED ACTIONS',22,121,{width:72});actionPill(doc,96,118,94,'PINWHEEL',pinwheels,ACTION_COLORS.pinwheel);actionPill(doc,196,118,94,'STRAPS',straps,ACTION_COLORS.strap);actionPill(doc,296,118,110,'LOAD LOCKS',locks,ACTION_COLORS.lock);doc.font('Helvetica-Bold').fontSize(4.8).fillColor('#333').text('CHECK EACH ACTION WHEN COMPLETE',414,121,{width:170,align:'right'});
  doc.fontSize(6).fillColor('#111').text('LEFT SIDE - ODD POSITIONS',26,133,{width:272,align:'center'}).text('RIGHT SIDE - EVEN POSITIONS',314,133,{width:272,align:'center'});
  for(let row=0;row<rows;row++)for(let side=0;side<2;side++){
    const pos=row*2+side+1,x=22+side*(w+gap),y=top+row*rowH+(row>=bulkRows?14:0),p=main.find(v=>v._slot===pos),partial=pos>cap,z=p?zone(p.code):'special',slotH=rowH-3,actionX=x+w-91,actionW=86;
    const actions=p?[pinwheelRequired(p)?{label:'PINWHEEL',color:ACTION_COLORS.pinwheel}:null,restraint(p)==='STRAP'?{label:'STRAP',color:ACTION_COLORS.strap}:null,restraint(p)==='LOAD LOCK'?{label:'LOAD LOCK',color:ACTION_COLORS.lock}:null].filter(Boolean):[];
    doc.roundedRect(x,y,w,slotH,4).lineWidth(actions.length?2.2:1).fillAndStroke(colors[z],actions.at(-1)?.color||'#555');doc.fillColor('#111').font('Helvetica-Bold').fontSize(9).text(String(pos),x+6,y+7,{width:18});
    if(partial){doc.fontSize(7).text('HAND STACK AREA - PARTIAL SPACE',x+28,y+8,{width:w-34});continue;}
    if(!p){const available=Number(job.trailer)===53&&pos>24;if(iceCreamInPos2&&pos===2){doc.fontSize(7).fillColor('#9b1017').text('ICE CREAM HAND STACK - IN FRONT OF DOOR',x+28,y+7,{width:w-125});actionBadge(doc,actionX,y+3,actionW,slotH-14,'HAND STACK',ACTION_COLORS.pinwheel);miniCheck(doc,actionX+3,y+slotH-10,'LOADED');continue;}const blank=available?'AVAILABLE PINWHEEL SPACE':pos<=freezerEnd?'DOOR SPACE / FREEZER PIR':'DOOR SPACE';doc.fontSize(7).fillColor('#111').text(blank,x+28,y+7,{width:w-125});if(!available){doc.roundedRect(x,y,w,slotH,4).lineWidth(2.2).stroke(ACTION_COLORS.lock);actionBadge(doc,actionX,y+3,actionW,slotH-14,'LOAD LOCK',ACTION_COLORS.lock);miniCheck(doc,actionX+3,y+slotH-10,'INSTALLED');}continue;}
    doc.fontSize(11).text(safe(p.code),x+28,y+4,{width:45});doc.font('Helvetica').fontSize(6.2).text(`${Number(p.weight).toLocaleString()} lb | Qty ${p.qty} | Stops ${safe(p.stops)}${p._source!==pos?` | Src ${p._source}`:''}`,x+75,y+6,{width:99,height:slotH-7});
    if(isSpecial(p)&&Number(p.weight)>200)doc.font('Helvetica-Bold').fontSize(4.5).fillColor('#9b1017').text('HAND-STACK REVIEW',x+75,y+slotH-8,{width:99});
    if(actions.length){const availableH=slotH-13,badgeH=Math.max(7,availableH/actions.length);actions.forEach((action,index)=>actionBadge(doc,actionX,y+2+index*badgeH,actionW,badgeH-1,action.label,action.color));miniCheck(doc,actionX+3,y+slotH-10,'LOADED');}
    else miniCheck(doc,actionX+3,y+slotH/2-4,'LOADED');
  }
  const bulkY=top+bulkRows*rowH;doc.rect(22,bulkY,562,11).fill('#111');doc.font('Helvetica-Bold').fontSize(5).fillColor('#fff').text('INSULATED BULKHEAD / BUN - FREEZER ABOVE | COOLER + DRY BELOW',24,bulkY+3,{width:558,align:'center'});
  let y=top+rows*rowH+13;
  if(hand.length){doc.roundedRect(22,y,562,42,4).fillAndStroke('#fff6f6','#c00');doc.font('Helvetica-Bold').fontSize(7).fillColor('#c00').text('HAND STACK ON BACK - OVER CAPACITY',28,y+4);doc.font('Helvetica').fontSize(6).fillColor('#111').text(hand.map(p=>`${safe(p.code)} ${p.weight}lb Qty ${p.qty}${p.weight>200?' REVIEW':''}`).join('   |   '),28,y+15,{width:550,height:22});y+=48;}
  if(specials.length){
    const panelH=24+specials.length*16;doc.roundedRect(22,y,562,panelH,4).fillAndStroke('#fff8e9','#a8660f');doc.font('Helvetica-Bold').fontSize(8).fillColor('#7a4708').text('SPECIAL ITEMS / HAND-STACK DIRECTIONS',28,y+5);let sy=y+18;
    specials.forEach(item=>{const direction=Number(item.weight)>200?`KEEP AS PALLET IN POS ${item.pos} - OVER 200 LB - REVIEW BEFORE HAND STACK`:specialPlacement(item,pallets);check(doc,28,sy,`CODE ${item.specialCode} | ${safe(item.code)} | ${item.weight} lb | Qty ${item.qty} | ${direction}`);sy+=16;});y+=panelH+6;
  }
  const totals={freezer:{p:0,w:0,q:0},cooler:{p:0,w:0,q:0},dry:{p:0,w:0,q:0}};sourceRows.forEach(p=>{const z=totals[zone(p.code)];z.p++;z.w+=Number(p.weight)||0;z.q+=Number(p.qty)||0;});
  doc.roundedRect(22,y,562,59,4).stroke('#555');doc.font('Helvetica-Bold').fontSize(8).fillColor('#111').text('COMPARTMENT TOTALS',28,y+5);let ty=y+18;Object.entries(totals).forEach(([k,v])=>{doc.fontSize(7).text(`${k.toUpperCase()}:  ${v.p} pallets   |   ${v.w.toLocaleString()} lb   |   Qty ${v.q}`,28,ty);ty+=11;});y+=65;
  const bw=180;await barcode(doc,'DRY LOADING ASSIGNMENT',job.barcodes?.dry,22,y,bw);await barcode(doc,'COOLER LOADING ASSIGNMENT',job.barcodes?.cooler,216,y,bw);await barcode(doc,'FROZEN LOADING ASSIGNMENT',job.barcodes?.frozen,410,y,174);y+=52;
  const handStackCount=hand.length+specials.filter(p=>Number(p.weight)<=200).length;check(doc,24,y,`PALLET SPACES ${pallets.length}`);check(doc,150,y,`HAND STACK ${handStackCount}`);check(doc,275,y,`PINWHEEL ${pinwheels}`);check(doc,395,y,`STRAPS ${straps}`);check(doc,490,y,`LOCKS ${locks}`);
}

function labelPage(doc,job,labels,pageIndex,pageCount){
  header(doc,job,'PALLET LABEL RECORD');doc.font('Helvetica-Bold').fontSize(7).fillColor('#c00').text(`ROUTE ${safe(job.route)} | PAGE ${pageIndex+1} OF ${pageCount} | PRINT AT 100% - EACH SPACE IS 3 x 1 INCH`,20,72,{width:572,align:'center'});
  for(let i=0;i<18;i++){const col=i%2,row=Math.floor(i/2),x=90+col*216,y=88+row*72,p=labels[i],special=p?.specialCode?` | SPECIAL ${safe(p.specialCode)}`:'';doc.rect(x,y,216,72).lineWidth(1).stroke('#777');doc.font('Helvetica-Bold').fontSize(7).fillColor('#111').text(p?`${safe(p.code)} | SOURCE POSITION ${p.pos}${special}`:`EXTRA LABEL SPACE`,x+7,y+6,{width:202});doc.font('Helvetica').fontSize(8).fillColor('#777').text('APPLY 3 x 1 LABEL HERE',x+7,y+33,{width:202,align:'center'});}
  check(doc,24,749,`LABEL PAGE ${pageIndex+1} COMPLETE`);doc.font('Helvetica').fontSize(8).fillColor('#111').text('Loader: ____________________    Time: __________',250,750);
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'POST required'});
  const jobs=Array.isArray(req.body?.jobs)?req.body.jobs.slice(0,25):[];if(!jobs.length)return res.status(400).json({error:'No load maps supplied'});
  if(jobs.some(job=>![28,36,48,53].includes(Number(job.trailer))))return res.status(400).json({error:'Every route must have a valid trailer size matched from the dispatch.'});
  try{const doc=new PDFDocument({size:'LETTER',margin:0,autoFirstPage:false,compress:true}),chunks=[];doc.on('data',c=>chunks.push(c));const done=new Promise((resolve,reject)=>{doc.on('end',resolve);doc.on('error',reject);});for(const job of jobs){doc.addPage();await loadMapPage(doc,job);const labels=job.pallets||[],pageCount=Math.max(1,Math.ceil(labels.length/18));for(let pageIndex=0;pageIndex<pageCount;pageIndex++){doc.addPage();labelPage(doc,job,labels.slice(pageIndex*18,(pageIndex+1)*18),pageIndex,pageCount);}}doc.end();await done;const pdf=Buffer.concat(chunks);res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`inline; filename="PFG_Load_Maps.pdf"`);res.setHeader('Cache-Control','no-store');return res.status(200).send(pdf);}catch(error){return res.status(500).json({error:error.message||'PDF generation failed'});}
}

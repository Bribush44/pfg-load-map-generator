import * as XLSX from 'xlsx';

const VALID_SIZES=new Set([28,36,48,53]);
const cleanHeader=value=>String(value??'').trim().toUpperCase().replace(/[^A-Z0-9#]/g,'');
const cleanRoute=value=>String(value??'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');

function trailerSize(value){
  const digits=String(value??'').replace(/\D/g,'');
  if(digits.length<2)return null;
  const size=Number(digits.slice(0,2));
  return VALID_SIZES.has(size)?size:null;
}

function locateColumns(rows){
  for(let rowIndex=0;rowIndex<Math.min(rows.length,30);rowIndex++){
    const headers=(rows[rowIndex]||[]).map(cleanHeader);
    const routeIndex=headers.findIndex(value=>value==='RT#'||value==='ROUTE'||value==='ROUTE#'||value.startsWith('ROUTE'));
    const trailerIndex=headers.findIndex(value=>value==='TRAILER'||value==='TRAILER#'||value.startsWith('TRAILER'));
    if(routeIndex>=0&&trailerIndex>=0)return{rowIndex,routeIndex,trailerIndex};
  }
  return null;
}

export default function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'POST required'});
  const encoded=req.body?.file;
  if(typeof encoded!=='string'||!encoded.length)return res.status(400).json({error:'Choose an Excel dispatch file first.'});
  if(encoded.length>12_000_000)return res.status(413).json({error:'The dispatch file is too large.'});
  try{
    const workbook=XLSX.read(Buffer.from(encoded,'base64'),{type:'buffer',cellDates:false,raw:false});
    const found=new Map(),warnings=[];let sheetsRead=0;
    for(const sheet of workbook.SheetNames){
      const rows=XLSX.utils.sheet_to_json(workbook.Sheets[sheet],{header:1,raw:false,defval:''});
      const columns=locateColumns(rows);if(!columns)continue;
      sheetsRead++;
      for(const row of rows.slice(columns.rowIndex+1)){
        const shownRoute=String(row[columns.routeIndex]??'').trim().toUpperCase(),key=cleanRoute(shownRoute);
        if(!key)continue;
        const trailerNumber=String(row[columns.trailerIndex]??'').trim(),size=trailerSize(trailerNumber);
        if(!size)continue;
        const previous=found.get(key);
        if(previous&&previous.trailer!==size){warnings.push(`${shownRoute} has conflicting trailer sizes; using ${previous.trailer} ft.`);continue;}
        if(!previous)found.set(key,{route:shownRoute,trailer:size,trailerNumber,sheet});
      }
    }
    if(!found.size)return res.status(422).json({error:'No route and trailer-size matches were found. The workbook must contain RT#/Route and TRAILER columns.'});
    return res.status(200).json({routes:[...found.values()],count:found.size,sheets:sheetsRead,warnings:warnings.slice(0,8)});
  }catch(error){
    return res.status(400).json({error:error.message||'The dispatch file could not be read.'});
  }
}

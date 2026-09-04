const schema={type:'object',additionalProperties:false,properties:{route:{type:'string'},door:{type:'string'},oppk:{type:'string'},date:{type:'string'},pallets:{type:'array',items:{type:'object',additionalProperties:false,properties:{pos:{type:'integer'},code:{type:'string'},cube:{type:'integer'},weight:{type:'integer'},qty:{type:'integer'},stops:{type:'string'}},required:['pos','code','cube','weight','qty','stops']}},barcodes:{type:'object',additionalProperties:false,properties:{dry:{type:'string'},cooler:{type:'string'},frozen:{type:'string'}},required:['dry','cooler','frozen']},review_notes:{type:'array',items:{type:'string'}}},required:['route','door','oppk','date','pallets','barcodes','review_notes']};
const shippingDate=value=>{const m=String(value||'').match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);if(!m)return String(value||'');const year=+m[3]<100?2000+(+m[3]):+m[3],d=new Date(Date.UTC(year,+m[1]-1,+m[2]+1));return`${String(d.getUTCMonth()+1).padStart(2,'0')}/${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCFullYear()).slice(-2)}`;};

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'POST required'});
  if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:'Server setup incomplete'});
  const {image,trailer}=req.body||{};
  if(typeof image!=='string'||!image.startsWith('data:image/')||image.length>12_000_000)return res.status(400).json({error:'Invalid or oversized image'});
  try{
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-5.4-mini',store:false,instructions:`Extract data from a photographed Performance Food Group pallet-plan sheet. Read only machine-printed text: ignore handwriting, pen marks, checkmarks, corrections, and marks crossing rows. Read the left and right printed columns independently. A pallet is valid only when the same printed row contains a position, a code matching F##, R##, or D##, cube, a positive weight, a positive quantity, and stops. A blank numbered position is not a pallet. Never invent a pallet from handwriting or a nearby row. Route must contain only the short printed route code after Route (for example 4B27), not the city. Door must come from the printed DockDr value in Compartment Totals and leading zeroes must be removed (025 becomes 25). For date, return the report date printed directly below the OPPK number; do not return the Deliver date. Capture position, code, cube, weight, quantity, and stops. Capture the exact digits printed below Dry, Cooler, and Frozen Loading Assignment. If any barcode digit is uncertain, return an empty string and explain it in review_notes. The selected trailer is ${Number(trailer)||0} feet, but do not change source positions or invent pallets.`,input:[{role:'user',content:[{type:'input_text',text:'Extract this load map into the required schema. Flag every uncertain field for human review.'},{type:'input_image',image_url:image,detail:'high'}]}],text:{format:{type:'json_schema',name:'load_map',strict:true,schema}}})});
    const data=await response.json();
    if(!response.ok)return res.status(response.status).json({error:data?.error?.message||'OpenAI analysis failed'});
    const output=data.output?.flatMap(x=>x.content||[]).find(x=>x.type==='output_text')?.text;
    if(!output)throw new Error('No structured output returned');
    const result=JSON.parse(output);
    result.route=(String(result.route||'').match(/[A-Z0-9]+/i)||[''])[0].toUpperCase();
    result.door=String(Number.parseInt(result.door,10)||'');
    result.date=shippingDate(result.date);
    const seen=new Set();
    result.pallets=(result.pallets||[]).map(p=>({...p,code:String(p.code||'').toUpperCase()})).filter(p=>Number.isInteger(p.pos)&&p.pos>0&&/^[FRD]\d{2}$/.test(p.code)&&p.weight>0&&p.qty>0&&!seen.has(p.pos)&&seen.add(p.pos)).sort((a,b)=>a.pos-b.pos);
    return res.status(200).json(result);
  }catch(error){return res.status(500).json({error:error.message||'Analysis failed'});}
}

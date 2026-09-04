import crypto from 'node:crypto';

const schema={type:'object',additionalProperties:false,properties:{route:{type:'string'},door:{type:'string'},oppk:{type:'string'},date:{type:'string'},pallets:{type:'array',items:{type:'object',additionalProperties:false,properties:{pos:{type:'integer'},code:{type:'string'},cube:{type:'integer'},weight:{type:'integer'},qty:{type:'integer'},stops:{type:'string'}},required:['pos','code','cube','weight','qty','stops']}},barcodes:{type:'object',additionalProperties:false,properties:{dry:{type:'string'},cooler:{type:'string'},frozen:{type:'string'}},required:['dry','cooler','frozen']},review_notes:{type:'array',items:{type:'string'}}},required:['route','door','oppk','date','pallets','barcodes','review_notes']};

function safeEqual(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&x.length>0&&crypto.timingSafeEqual(x,y)}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'POST required'});
  if(!process.env.OPENAI_API_KEY||!process.env.APP_ACCESS_CODE)return res.status(503).json({error:'Server setup incomplete'});
  if(!safeEqual(req.headers['x-app-code'],process.env.APP_ACCESS_CODE))return res.status(401).json({error:'Incorrect private app code'});
  const {image,trailer}=req.body||{};
  if(typeof image!=='string'||!image.startsWith('data:image/')||image.length>12_000_000)return res.status(400).json({error:'Invalid or oversized image'});
  try{
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-5.4-mini',store:false,instructions:`Extract data from a photographed Performance Food Group pallet-plan sheet. Transcribe only visible values and never infer missing digits. Pallet codes must match F##, R##, or D##. Each printed line item is one pallet. Capture position, code, cube, weight, quantity, and stops. Capture the exact values for Dry, Cooler, and Frozen Loading Assignment barcodes. If a barcode character is uncertain, return an empty string and explain it in review_notes. The selected trailer is ${Number(trailer)||0} feet, but do not change source positions or invent pallets.`,input:[{role:'user',content:[{type:'input_text',text:'Extract this load map into the required schema. Flag every uncertain field for human review.'},{type:'input_image',image_url:image,detail:'high'}]}],text:{format:{type:'json_schema',name:'load_map',strict:true,schema}}})});
    const data=await response.json();
    if(!response.ok)return res.status(response.status).json({error:data?.error?.message||'OpenAI analysis failed'});
    const output=data.output?.flatMap(x=>x.content||[]).find(x=>x.type==='output_text')?.text;
    if(!output)throw new Error('No structured output returned');
    return res.status(200).json(JSON.parse(output));
  }catch(error){return res.status(500).json({error:error.message||'Analysis failed'});}
}

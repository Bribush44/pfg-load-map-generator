const schema={type:'object',additionalProperties:false,properties:{routes:{type:'array',items:{type:'object',additionalProperties:false,properties:{route:{type:'string'},trailerNumber:{type:'string'}},required:['route','trailerNumber']}},review_notes:{type:'array',items:{type:'string'}}},required:['routes','review_notes']};
const VALID_SIZES=new Set([28,36,48,53]);
const routeKey=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const trailerSize=value=>{const digits=String(value||'').replace(/\D/g,'');if(digits.length<2)return null;const size=Number(digits.slice(0,2));return VALID_SIZES.has(size)?size:null;};

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'POST required'});
  if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:'Server setup incomplete'});
  const image=req.body?.image;
  if(typeof image!=='string'||!image.startsWith('data:image/')||image.length>12_000_000)return res.status(400).json({error:'Invalid or oversized dispatch photo'});
  try{
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:'gpt-5.4-mini',store:false,instructions:'Read a photographed PFG dispatch spreadsheet. Extract every visible route from the RT# or Route column and the trailer number from the TRAILER column on the same row. Do not use the separate TRUCK column; it contains tractor numbers, not trailer sizes. A trailer may be a full number such as 5316021 or 2820012-2, or only 28, 36, 48, or 53. Ignore headings, driver names, door numbers, schedule times, destinations, shuttle labels, blank rows, handwriting, and uncertain rows. Preserve the visible route and trailer number. If either value is uncertain, omit that row and explain it in review_notes.',input:[{role:'user',content:[{type:'input_text',text:'Extract the route and trailer pairs visible in this dispatch photo.'},{type:'input_image',image_url:image,detail:'high'}]}],text:{format:{type:'json_schema',name:'dispatch_routes',strict:true,schema}}})});
    const data=await response.json();if(!response.ok)return res.status(response.status).json({error:data?.error?.message||'OpenAI dispatch analysis failed'});
    const output=data.output?.flatMap(x=>x.content||[]).find(x=>x.type==='output_text')?.text;if(!output)throw new Error('No dispatch data returned');
    const parsed=JSON.parse(output),seen=new Set(),routes=[];
    for(const row of parsed.routes||[]){const route=routeKey(row.route),trailerNumber=String(row.trailerNumber||'').trim(),trailer=trailerSize(trailerNumber);if(!route||!trailer||seen.has(route))continue;seen.add(route);routes.push({route,trailer,trailerNumber,sheet:'Dispatch photo'});}
    if(!routes.length)return res.status(422).json({error:'No readable Route and TRAILER pairs were found in this photo. Retake it closer and keep both columns visible.'});
    return res.status(200).json({routes,review_notes:parsed.review_notes||[]});
  }catch(error){return res.status(500).json({error:error.message||'Dispatch photo analysis failed'});}
}

// ── CONFIG ────────────────────────────────────────────────────────────────────
const SUPABASE_URL='https://wbetwrnqdkfldmceyvun.supabase.co';
const SUPABASE_KEY='sb_publishable_HonxeV201TiNCi2qrYx6Jw_BbJRi4Gu';
const AI='https://api.anthropic.com/v1/messages';

// ── SUPABASE ──────────────────────────────────────────────────────────────────
const SB={
  async query(table,params=''){
    const r=await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`,{headers:{'apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`}});
    if(!r.ok)throw new Error(await r.text());
    return r.json();
  },
  async insert(table,body){
    const r=await fetch(`${SUPABASE_URL}/rest/v1/${table}`,{method:'POST',headers:{'apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`,'Content-Type':'application/json','Prefer':'return=representation'},body:JSON.stringify(body)});
    if(!r.ok)throw new Error(await r.text());
    return r.json();
  },
  async remove(table,params){
    const r=await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`,{method:'DELETE',headers:{'apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`}});
    if(!r.ok)throw new Error(await r.text());
  }
};

// ── STATE ─────────────────────────────────────────────────────────────────────
let goals={calories:null,protein:null,carbs:null,fat:null};
let weights=[];
let currentDate=todayStr();
let currentMeal='Breakfast';
let pendingFood=null;
let servingMode='grams';
let todayLogs=[];

function todayStr(){return new Date().toISOString().split('T')[0]}

// Goals — persisted in Supabase (single row id=1), localStorage as offline backup
async function loadGoals(){
  try{
    const rows=await SB.query('goals','?id=eq.1&select=calories,protein,carbs,fat');
    if(rows.length>0){
      const g=rows[0];
      goals={calories:g.calories,protein:g.protein,carbs:g.carbs,fat:g.fat};
      return;
    }
  }catch(e){}
  // Fall back to localStorage if Supabase unreachable
  try{const g=localStorage.getItem('nt-goals');if(g)goals=JSON.parse(g);}catch(e){}
}
async function saveGoalsRemote(){
  try{
    await fetch(`${SUPABASE_URL}/rest/v1/goals?id=eq.1`,{
      method:'PATCH',
      headers:{'apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`,'Content-Type':'application/json','Prefer':'return=minimal'},
      body:JSON.stringify({calories:goals.calories,protein:goals.protein,carbs:goals.carbs,fat:goals.fat,updated_at:new Date().toISOString()})
    });
  }catch(e){}
  // Always mirror to localStorage as offline backup
  localStorage.setItem('nt-goals',JSON.stringify(goals));
}

// Weights — localStorage only for now
function loadWeights(){
  try{const w=localStorage.getItem('nt-weights');if(w)weights=JSON.parse(w);}catch(e){}
}
function saveWeightsLocal(){localStorage.setItem('nt-weights',JSON.stringify(weights))}

// ── DATE ──────────────────────────────────────────────────────────────────────
function changeDay(d){
  const dt=new Date(currentDate+'T12:00:00');dt.setDate(dt.getDate()+d);
  if(dt>new Date())return;
  currentDate=dt.toISOString().split('T')[0];loadTodayLogs();
}
function formatDate(str){
  const t=todayStr(),y=new Date();y.setDate(y.getDate()-1);const ys=y.toISOString().split('T')[0];
  if(str===t)return'Today';if(str===ys)return'Yesterday';
  return new Date(str+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
}

// ── LOGS ──────────────────────────────────────────────────────────────────────
async function loadTodayLogs(){
  document.getElementById('date-display').textContent=formatDate(currentDate);
  try{
    const from=currentDate+'T00:00:00.000Z',to=currentDate+'T23:59:59.999Z';
    todayLogs=await SB.query('Food_Logs',`?date=gte.${from}&date=lte.${to}&select=*`);
  }catch(e){todayLogs=[];}
  renderToday();
}
async function deleteLog(id){
  try{await SB.remove('Food_Logs',`?id=eq.${id}`);await loadTodayLogs();showToast('Removed');}
  catch(e){showToast('Error removing entry');}
}

// ── RENDER TODAY ──────────────────────────────────────────────────────────────
function renderToday(){
  let tc=0,tp=0,tca=0,tf=0;
  todayLogs.forEach(l=>{tc+=l.calories||0;tp+=l.protein||0;tca+=l.carbs||0;tf+=l.fat||0;});
  tc=Math.round(tc);tp=Math.round(tp);tca=Math.round(tca);tf=Math.round(tf);
  ['Breakfast','Lunch','Dinner','Snacks'].forEach(meal=>{
    const el=document.getElementById('meal-'+meal.toLowerCase());
    const items=todayLogs.filter(l=>l.meal===meal);
    if(!items.length){el.innerHTML='<div class="empty-state"><span class="empty-icon">🥣</span>No entries yet</div>';return;}
    el.innerHTML=items.map(l=>`<div class="food-item">
      <div class="food-icon">${mealEmoji(meal)}</div>
      <div class="food-info">
        <div class="food-name">${l.food_name||'—'}</div>
        <div class="food-meta">${l.serving_size||''} · P:${Math.round(l.protein||0)}g C:${Math.round(l.carbs||0)}g F:${Math.round(l.fat||0)}g</div>
      </div>
      <span class="food-cal">${Math.round(l.calories||0)}</span>
      <button class="food-del" onclick="deleteLog(${l.id})">✕</button>
    </div>`).join('');
  });
  document.getElementById('ring-cal').textContent=tc;
  const gc=goals.calories||0;
  document.getElementById('ring-progress').style.strokeDashoffset=gc?251.2*(1-Math.min(tc/gc,1)):251.2;
  document.getElementById('ring-progress').style.stroke=tc>gc&&gc?'#ef4444':'#10b981';
  document.getElementById('today-protein').textContent=tp+'g';
  document.getElementById('today-carbs').textContent=tca+'g';
  document.getElementById('today-fat').textContent=tf+'g';
  document.getElementById('goal-protein-lbl').textContent=goals.protein?'/ '+goals.protein+'g':'';
  document.getElementById('goal-carbs-lbl').textContent=goals.carbs?'/ '+goals.carbs+'g':'';
  document.getElementById('goal-fat-lbl').textContent=goals.fat?'/ '+goals.fat+'g':'';
  if(goals.protein)document.getElementById('bar-protein').style.width=Math.min(tp/goals.protein*100,100)+'%';
  if(goals.carbs)document.getElementById('bar-carbs').style.width=Math.min(tca/goals.carbs*100,100)+'%';
  if(goals.fat)document.getElementById('bar-fat').style.width=Math.min(tf/goals.fat*100,100)+'%';
  document.getElementById('cal-goal-lbl').textContent=gc||'—';
  document.getElementById('cal-remain').textContent=gc?Math.max(gc-tc,0):'—';
  renderStreak();
}
function mealEmoji(m){return{Breakfast:'☕',Lunch:'🥗',Dinner:'🍽️',Snacks:'🍎'}[m]||'🍴'}

async function renderStreak(){
  // Single query for 60-day window, group by date client-side
  try{
    const cutoff=new Date();cutoff.setDate(cutoff.getDate()-60);
    const logs=await SB.query('Food_Logs','?date=gte.'+cutoff.toISOString()+'&select=date');
    const daysWithLogs=new Set(logs.map(l=>l.date.split('T')[0]));
    let streak=0;
    for(let i=0;i<60;i++){
      const d=new Date();d.setDate(d.getDate()-i);
      if(daysWithLogs.has(d.toISOString().split('T')[0]))streak++;
      else if(i>0)break;
    }
    document.getElementById('streak-val').textContent=streak;
  }catch(e){document.getElementById('streak-val').textContent='—';}
}

// ── HISTORY ───────────────────────────────────────────────────────────────────
let historyChart=null;
async function renderHistory(){
  // Single query for 14-day window, group by date client-side
  const from14=new Date();from14.setDate(from14.getDate()-13);
  from14.setHours(0,0,0,0);
  let allLogs=[];
  try{allLogs=await SB.query('Food_Logs','?date=gte.'+from14.toISOString()+'&select=date,calories');}catch(e){}

  // Sum calories per date string
  const calByDate={};
  allLogs.forEach(l=>{const day=l.date.split('T')[0];calByDate[day]=(calByDate[day]||0)+(l.calories||0);});

  const dates=[],cals=[];
  for(let i=13;i>=0;i--){
    const d=new Date();d.setDate(d.getDate()-i);
    const str=d.toISOString().split('T')[0];
    dates.push(formatDate(str));
    cals.push(Math.round(calByDate[str]||0));
  }

  const ctx=document.getElementById('history-chart').getContext('2d');if(historyChart)historyChart.destroy();
  const gc=goals.calories||0;
  historyChart=new Chart(ctx,{type:'bar',data:{labels:dates,datasets:[{data:cals,backgroundColor:cals.map(c=>gc&&c>gc?'#ef4444':'#10b981'),borderRadius:4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:v=>v.raw+' kcal'}}},scales:{x:{grid:{display:false},ticks:{font:{size:10},maxRotation:45}},y:{grid:{color:'rgba(0,0,0,.05)'},ticks:{font:{size:10}}}}}});
  const list=document.getElementById('history-list'),rows=[];
  for(let i=0;i<14;i++){const d=new Date();d.setDate(d.getDate()-i);const str=d.toISOString().split('T')[0];const c=Math.round(calByDate[str]||0);if(!c)continue;rows.push('<div class="card" style="padding:.75rem 1rem;margin-bottom:.5rem"><div style="display:flex;justify-content:space-between"><span style="font-size:14px;font-weight:500">'+formatDate(str)+'</span><span style="font-size:14px;font-weight:600;color:'+(gc&&c>gc?'#ef4444':'#10b981')+'">'+c+' kcal</span></div></div>');}
  list.innerHTML=rows.length?rows.join(''):'<div class="empty-state"><span class="empty-icon">📊</span>No history yet</div>';
}

// ── WEIGHT ────────────────────────────────────────────────────────────────────
let weightChart=null;
function renderWeight(){
  const list=document.getElementById('weight-list');
  list.innerHTML=weights.length?weights.slice().reverse().slice(0,15).map(w=>`<div class="weight-log-item"><span style="color:#999;font-size:13px">${formatDate(w.date)}</span><span style="font-weight:600">${w.value} ${w.unit}</span></div>`).join(''):'<div class="empty-state"><span class="empty-icon">⚖️</span>No weight entries yet</div>';
  const ctx=document.getElementById('weight-chart').getContext('2d');if(weightChart)weightChart.destroy();
  const wd=weights.slice(-30);
  weightChart=new Chart(ctx,{type:'line',data:{labels:wd.length?wd.map(w=>formatDate(w.date)):[''],datasets:[{data:wd.length?wd.map(w=>w.value):[0],borderColor:'#10b981',backgroundColor:'rgba(16,185,129,.1)',fill:true,tension:.3,pointRadius:4,pointBackgroundColor:'#10b981'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{grid:{display:false},ticks:{font:{size:10},maxRotation:45}},y:{grid:{color:'rgba(0,0,0,.05)'},ticks:{font:{size:10}}}}}});
}
function logWeight(){
  const val=parseFloat(document.getElementById('weight-input').value),unit=document.getElementById('weight-unit').value;
  if(isNaN(val)||val<20)return showToast('Enter a valid weight');
  weights.push({date:todayStr(),value:val,unit});weights.sort((a,b)=>a.date.localeCompare(b.date));
  document.getElementById('weight-input').value='';saveWeightsLocal();renderWeight();showToast('Weight logged');
}

// ── GOALS ─────────────────────────────────────────────────────────────────────
function gv(id){const v=parseFloat(document.getElementById(id).value);return isNaN(v)||v<0?null:v}
function sv(id,val){document.getElementById(id).value=val===null?'':String(Math.round(val*10)/10)}
function onMacroInput(){updateGoalPreview()}
function onCalInput(){
  const nc=gv('g-cal'),p=gv('g-protein'),c=gv('g-carbs'),f=gv('g-fat');
  if(nc===null){updateGoalPreview();return}
  const cur=(p||0)*4+(c||0)*4+(f||0)*9;
  if(cur>0){const r=nc/cur;if(p!==null)sv('g-protein',p*r);if(c!==null)sv('g-carbs',c*r);if(f!==null)sv('g-fat',f*r)}
  updateGoalPreview();
}
function updateGoalPreview(){
  const p=gv('g-protein')||0,c=gv('g-carbs')||0,f=gv('g-fat')||0,cal=gv('g-cal')||0;
  const pv=document.getElementById('goals-preview');
  if(!p&&!c&&!f&&!cal){pv.style.display='none';return}pv.style.display='block';
  const mk=p*4+c*4+f*9,isOver=cal>0&&mk>cal,excess=isOver?mk-cal:0,unused=!isOver&&cal>0?cal-mk:0,bt=Math.max(cal,mk)||1;
  document.getElementById('seg-p').style.flex=String(p*4/bt);document.getElementById('seg-c').style.flex=String(c*4/bt);document.getElementById('seg-f').style.flex=String(f*9/bt);document.getElementById('seg-u').style.flex=String(unused/bt);document.getElementById('seg-x').style.flex=String(excess/bt);
  document.getElementById('lbl-p').textContent=p?'Protein '+Math.round(p*4/bt*100)+'%':'';document.getElementById('lbl-c').textContent=c?'Carbs '+Math.round(c*4/bt*100)+'%':'';document.getElementById('lbl-f').textContent=f?'Fat '+Math.round(f*9/bt*100)+'%':'';document.getElementById('lbl-u').textContent=unused>0?'Unassigned '+Math.round(unused/bt*100)+'%':'';document.getElementById('lbl-x').textContent=excess>0?'Over by '+Math.round(excess)+' kcal':'';
  const bd=document.getElementById('cal-breakdown'),parts=[];
  if(p)parts.push(`<strong>${Math.round(p)}g</strong> protein × 4 = <strong>${Math.round(p*4)}</strong> kcal`);if(c)parts.push(`<strong>${Math.round(c)}g</strong> carbs × 4 = <strong>${Math.round(c*4)}</strong> kcal`);if(f)parts.push(`<strong>${Math.round(f)}g</strong> fat × 9 = <strong>${Math.round(f*9)}</strong> kcal`);
  const status=isOver?` — <strong style="color:#ef4444">+${Math.round(excess)} kcal over</strong>`:unused>0?` — <strong>${Math.round(unused)} kcal unassigned</strong>`:' — balanced ✓';
  bd.innerHTML=parts.join(' · ')+(parts.length?' · ':'')+'= <strong>'+Math.round(mk)+' kcal</strong>'+status;bd.className='cal-breakdown '+(isOver?'over':'ok');
}
function renderGoalsPage(){sv('g-cal',goals.calories);sv('g-protein',goals.protein);sv('g-carbs',goals.carbs);sv('g-fat',goals.fat);updateGoalPreview()}
async function saveGoals(){
  goals={calories:gv('g-cal'),protein:gv('g-protein'),carbs:gv('g-carbs'),fat:gv('g-fat')};
  await saveGoalsRemote();
  renderToday();showToast('Goals saved');showPage('today',document.getElementById('tab-today'));
}

// ── MODAL ─────────────────────────────────────────────────────────────────────
function openAdd(meal){
  currentMeal=meal;
  document.getElementById('modal-title').textContent='Add to '+meal;
  document.getElementById('add-modal').classList.add('open');
  goToStep('step-method');selectMethod('label');resetAllInputs();
}
function closeModal(){document.getElementById('add-modal').classList.remove('open');pendingFood=null;}
document.getElementById('add-modal').addEventListener('click',e=>{if(e.target===document.getElementById('add-modal'))closeModal();});
function goToStep(id){document.querySelectorAll('.step').forEach(s=>s.classList.remove('active'));document.getElementById(id).classList.add('active')}
function goBackToMethod(){goToStep('step-method');pendingFood=null;}

function selectMethod(m){
  ['label','identify','search','manual'].forEach(x=>{
    document.getElementById('method-'+x).style.display=x===m?'block':'none';
    document.getElementById('tab-'+x+'-btn').classList.toggle('active',x===m);
  });
}

function resetAllInputs(){
  // label
  document.getElementById('label-preview').style.display='none';setStatus('label-status','','');document.getElementById('label-input').value='';
  // identify
  document.getElementById('identify-preview').style.display='none';setStatus('identify-status','','');document.getElementById('identify-input').value='';
  // search
  document.getElementById('search-input').value='';setStatus('search-status','','');document.getElementById('search-results').style.display='none';document.getElementById('search-results').innerHTML='';
  // manual
  ['manual-name','manual-serving-other','manual-serving-grams','manual-cal','manual-protein','manual-carbs','manual-fat'].forEach(id=>document.getElementById(id).value='');
  setStatus('manual-status','','');
}

function setStatus(id,msg,type){const el=document.getElementById(id);el.textContent=msg;el.className='status-msg'+(msg?' visible':'')+(type?' '+type:'');}

// ── CLAUDE AI CALL ────────────────────────────────────────────────────────────
async function claudeCall(messages,maxTokens){
  const r=await fetch(AI,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:maxTokens||600,messages})});
  const d=await r.json();
  const text=d.content?.filter(b=>b.type==='text').map(b=>b.text).join('');
  return JSON.parse(text.replace(/```json|```/g,'').trim());
}

// ── SCAN NUTRITION LABEL ──────────────────────────────────────────────────────
async function handleLabelScan(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=async e=>{
    const img=document.getElementById('label-preview');img.src=e.target.result;img.style.display='block';
    setStatus('label-status','🔍 Reading label…','');
    try{
      const result=await claudeCall([{role:'user',content:[
        {type:'image',source:{type:'base64',media_type:file.type||'image/jpeg',data:e.target.result.split(',')[1]}},
        {type:'text',text:'Read this nutrition label carefully. Respond ONLY with JSON (no markdown, no extra text): {"name":"product name","calories_per_serving":number,"protein_per_serving":number,"carbs_per_serving":number,"fat_per_serving":number,"serving_grams":number_or_null,"serving_other":"household measure e.g. 1 cup or 2 cookies or null"}. All values per ONE serving as labeled.'}
      ]}],800);
      setStatus('label-status','','');
      await resolveFood(result,'label');
    }catch(err){setStatus('label-status','Could not read label — try a clearer photo.','error');}
  };reader.readAsDataURL(file);
}

// ── IDENTIFY WHOLE RAW FOOD ───────────────────────────────────────────────────
async function handleIdentifyScan(input){
  const file=input.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=async e=>{
    const img=document.getElementById('identify-preview');img.src=e.target.result;img.style.display='block';
    setStatus('identify-status','🔍 Identifying food…','');
    try{
      const result=await claudeCall([{role:'user',content:[
        {type:'image',source:{type:'base64',media_type:file.type||'image/jpeg',data:e.target.result.split(',')[1]}},
        {type:'text',text:`Identify the raw whole food in this photo.

Only identify: fresh fruit, fresh vegetables, raw dry grains (uncooked rice/pasta/oats), raw nuts, seeds, eggs, raw meat or fish.
Do NOT identify: cooked dishes, meals with multiple ingredients, packaged foods, anything unclear.

If it IS a clear single raw ingredient, respond ONLY with JSON (no markdown):
{"name":"specific food name e.g. Raspberries raw","calories_per_serving":number,"protein_per_serving":number,"carbs_per_serving":number,"fat_per_serving":number,"serving_grams":number,"serving_other":"standard serving e.g. 1 cup or 1 medium"}

If NOT identifiable as a single raw ingredient, respond ONLY with:
{"error":"brief reason"}`}
      ]}],800);
      if(result.error){setStatus('identify-status',`Can't identify: ${result.error}. Try Search instead.`,'error');return;}
      setStatus('identify-status','','');
      await resolveFood(result,'identify');
    }catch(err){setStatus('identify-status','Could not identify — try a clearer photo or use Search.','error');}
  };reader.readAsDataURL(file);
}

// ── SEARCH ────────────────────────────────────────────────────────────────────
async function doSearch(){
  const query=document.getElementById('search-input').value.trim();if(!query)return;
  const resultsEl=document.getElementById('search-results');resultsEl.style.display='none';resultsEl.innerHTML='';
  setStatus('search-status','🔍 Searching your database…','');
  // 1. Your Supabase DB first
  try{
    const dbResults=await SB.query('Foods',`?name=ilike.*${encodeURIComponent(query)}*&limit=6`);
    if(dbResults.length>0){
      setStatus('search-status','','');
      showResults(dbResults.map(f=>({...f,_src:'db'})));return;
    }
  }catch(e){}
  // 2. Claude with USDA knowledge
  setStatus('search-status','🤖 Looking up nutrition…','');
  try{
    const result=await claudeCall([{role:'user',content:`USDA nutrition data for: "${query}". Respond ONLY with JSON (no markdown): {"name":"specific USDA food name","calories_per_serving":number,"protein_per_serving":number,"carbs_per_serving":number,"fat_per_serving":number,"serving_grams":number,"serving_other":"standard serving e.g. 1 cup or 1 medium apple"}. serving_grams must be a number — grams per one serving. Use USDA FoodData Central values.`}]);
    setStatus('search-status','','');
    showResults([{...result,_src:'claude'}]);
  }catch(err){setStatus('search-status','No results found. Try different words or use Manual entry.','error');}
}

function showResults(items){
  const el=document.getElementById('search-results');
  el.innerHTML=items.map((item,i)=>{
    const badge=item._src==='db'?'<span class="source-badge db">Your DB</span>':'<span class="source-badge ai">USDA via AI</span>';
    const sub=item.serving_other||'';
    return`<div class="search-result-item" onclick="pickResult(${i})">
      <div class="search-result-name">${item.name}${badge}</div>
      <div class="search-result-meta">${sub}</div>
    </div>`;
  }).join('');
  el.style.display='block';el._items=items;
}

async function pickResult(i){
  const item=document.getElementById('search-results')._items[i];
  setStatus('search-status','','');document.getElementById('search-results').style.display='none';
  if(item._src==='db'){pendingFood=item;showServingStep('db');return;}
  await resolveFood(item,'claude');
}

// ── MANUAL ENTRY ──────────────────────────────────────────────────────────────
async function submitManual(){
  const name=document.getElementById('manual-name').value.trim();
  if(!name){setStatus('manual-status','Please enter a food name.','error');return;}
  const cal=parseFloat(document.getElementById('manual-cal').value)||0;
  const protein=parseFloat(document.getElementById('manual-protein').value)||0;
  const carbs=parseFloat(document.getElementById('manual-carbs').value)||0;
  const fat=parseFloat(document.getElementById('manual-fat').value)||0;
  const serving_other=document.getElementById('manual-serving-other').value.trim()||null;
  const serving_grams=parseFloat(document.getElementById('manual-serving-grams').value)||null;
  const food={
    name,calories_per_serving:cal,protein_per_serving:protein,
    carbs_per_serving:carbs,fat_per_serving:fat,
    serving_grams:serving_grams?Math.round(serving_grams):null,
    serving_other,source:'manual'
  };
  await resolveFood(food,'manual');
}

// ── RESOLVE: DB CHECK → SAVE → SERVING STEP ──────────────────────────────────
async function resolveFood(extracted,source){
  // Check DB by name
  try{
    const rows=await SB.query('Foods',`?name=ilike.${encodeURIComponent(extracted.name)}&limit=1`);
    if(rows.length>0){pendingFood=rows[0];showServingStep('db');return;}
  }catch(e){}
  // Not in DB — save it
  const newFood={
    name:extracted.name,
    calories_per_serving:Math.round(extracted.calories_per_serving||0),
    protein_per_serving:Math.round(extracted.protein_per_serving||0),
    carbs_per_serving:Math.round(extracted.carbs_per_serving||0),
    fat_per_serving:Math.round(extracted.fat_per_serving||0),
    serving_grams:extracted.serving_grams?Math.round(extracted.serving_grams):null,
    serving_other:extracted.serving_other||null,
    source,
    user_id:'rebecca'  // replace with auth.uid() when login is added
  };
  try{const ins=await SB.insert('Foods',newFood);pendingFood=ins[0]||newFood;}
  catch(e){pendingFood=newFood;}
  showServingStep('new');
}

// ── SERVING STEP ──────────────────────────────────────────────────────────────
function showServingStep(dbStatus){
  const f=pendingFood;
  document.getElementById('match-name').textContent=f.name;
  const src=document.getElementById('match-source');
  if(dbStatus==='db') src.innerHTML='<span class="source-badge db">✓ Found in your database</span>';
  else if(dbStatus==='new') src.innerHTML='<span class="source-badge ai">✨ Added to your database</span>';
  else src.innerHTML='<span class="source-badge manual">✏️ Manual entry</span>';

  const sg=f.serving_grams,so=f.serving_other,desc=so?so:(sg?sg+'g':'1 serving');
  document.getElementById('match-macros').innerHTML=`
    <div class="match-macro"><div class="match-macro-val">${f.calories_per_serving||0}</div><div class="match-macro-name">kcal</div></div>
    <div class="match-macro"><div class="match-macro-val">${f.protein_per_serving||0}g</div><div class="match-macro-name">protein</div></div>
    <div class="match-macro"><div class="match-macro-val">${f.carbs_per_serving||0}g</div><div class="match-macro-name">carbs</div></div>
    <div class="match-macro"><div class="match-macro-val">${f.fat_per_serving||0}g</div><div class="match-macro-name">fat</div></div>
    <div style="grid-column:1/-1;font-size:11px;color:#999;text-align:center">per serving (${desc})</div>`;

  document.getElementById('by-grams-btn').style.display=sg?'':'none';
  setServingMode(sg?'grams':'servings');
  document.getElementById('serving-amount').value='';document.getElementById('serving-preview').textContent='';
  goToStep('step-serving');
}

function setServingMode(mode){
  servingMode=mode;
  document.getElementById('by-grams-btn').classList.toggle('active',mode==='grams');
  document.getElementById('by-servings-btn').classList.toggle('active',mode==='servings');
  const f=pendingFood;
  document.getElementById('serving-unit-label').textContent=mode==='grams'?'grams':'× '+(f?.serving_other||(f?.serving_grams?f.serving_grams+'g':'serving'));
  updateServingPreview();
}

function updateServingPreview(){
  const f=pendingFood;if(!f)return;
  const amt=parseFloat(document.getElementById('serving-amount').value);
  if(isNaN(amt)||amt<=0){document.getElementById('serving-preview').textContent='';return;}
  let ratio;
  if(servingMode==='grams'){
    if(!f.serving_grams){document.getElementById('serving-preview').textContent='No gram weight on file';return;}
    ratio=amt/f.serving_grams;
  }else{ratio=amt;}
  const cal=Math.round((f.calories_per_serving||0)*ratio);
  const p=Math.round((f.protein_per_serving||0)*ratio);
  const c=Math.round((f.carbs_per_serving||0)*ratio);
  const ft=Math.round((f.fat_per_serving||0)*ratio);
  document.getElementById('serving-preview').textContent=`→ ${cal} kcal · P:${p}g C:${c}g F:${ft}g`;
}

async function confirmLog(){
  const f=pendingFood;if(!f)return;
  const amt=parseFloat(document.getElementById('serving-amount').value);
  if(isNaN(amt)||amt<=0){showToast('Enter an amount');return;}
  let ratio,grams=null,servingSize;
  if(servingMode==='grams'){
    ratio=amt/f.serving_grams;grams=Math.round(amt);servingSize=amt+'g';
  }else{
    ratio=amt;grams=f.serving_grams?Math.round(f.serving_grams*amt):null;
    const so=f.serving_other||(f.serving_grams?f.serving_grams+'g':'serving');
    servingSize=amt+' × '+so;
  }
  const entry={
    date:new Date(currentDate+'T12:00:00').toISOString(),
    meal:currentMeal,food_id:f.name,food_name:f.name,
    grams,serving_size:servingSize,
    calories:Math.round((f.calories_per_serving||0)*ratio),
    protein:Math.round((f.protein_per_serving||0)*ratio),
    carbs:Math.round((f.carbs_per_serving||0)*ratio),
    fat:Math.round((f.fat_per_serving||0)*ratio),
    user_id:'rebecca'  // replace with auth.uid() when login is added
  };
  const btn=document.getElementById('confirm-btn');btn.disabled=true;btn.textContent='Saving…';
  try{
    await SB.insert('Food_Logs',entry);closeModal();await loadTodayLogs();showToast(f.name+' added');
  }catch(err){showToast('Error saving — check Supabase RLS');console.error(err);}
  finally{btn.disabled=false;btn.textContent='Add to meal';}
}

// ── NAV ───────────────────────────────────────────────────────────────────────
function showPage(page,btn){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  if(btn)btn.classList.add('active');
  if(page==='history')renderHistory();
  if(page==='weight')renderWeight();
  if(page==='goals')renderGoalsPage();
}
function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2400);}

if('serviceWorker' in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('sw.js').catch(()=>{});});}

async function init(){
  loadWeights();
  await loadGoals();
  await loadTodayLogs();
}
init();

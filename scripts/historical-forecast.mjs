// Forecasts use only completed prior days. Real-time observations are never
// replaced with predictions, and known source outages are excluded from fitting.
export const VERSION='historical-forecast-v1';
export const EXCLUDED_DAYS=new Set(['2026-11-24']);
export const ANCHORS=[540,780,1020,1260];
export const METHODS=['previous','median7','median14','median28','weekday28','mean14','blend14'];
export const METRICS=[
 ['B',9],['C',10],['D',11],['E',12],['F',13],['G',14],['H',15],['I',16],['J',17],['K',18],['L',19],['M',20],['N',21],['O',22],['R',23],['S',24],['P',25],['Q',26],['T',27],['U',28],['V',29],['W',30],['X',33],['Y',34],['GA4',35],['AA',37],['AB',40],['AC',41],['AF',42],['AG',43],['AL',48],['AM',49],['AN',50],['AO',51],['AP',52],['AQ',53],['AR',54],['AS',55]
].map(([column,row],index)=>({column,row,index,stock:column==='GA4'}));
export const columnIndex=s=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
export const columnName=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const dayNumber=d=>Date.parse(d+'T00:00:00Z')/86400000;
const weekday=d=>new Date(d+'T00:00:00Z').getUTCDay();
function weightedMedian(a){const s=a.filter(x=>finite(x.v)&&x.w>0).sort((a,b)=>a.v-b.v);if(!s.length)return null;const half=s.reduce((n,x)=>n+x.w,0)/2;let w=0;for(const x of s){w+=x.w;if(w>=half)return x.v;}return s.at(-1).v;}
export function at(day,minute,maxLag=45){if(!day)return null;const cutoff=Math.min(minute,1439)+.999;let found;for(const p of day){if(p.minute>cutoff)break;found=p;}return found&&cutoff-found.minute<=maxLag+1?found.value:null;}
export function buildHistory(rows,ga4=[]){
 const history=new Map(METRICS.map(m=>[m.column,new Map()]));
 for(const raw of rows){const r=Array.isArray(raw)?raw:raw.values,t=r[0];if(typeof t!=='string'||!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(t))continue;const d=t.slice(0,10),minute=Number(t.slice(11,13))*60+Number(t.slice(14,16));
  for(const m of METRICS){if(m.stock)continue;const v=r[columnIndex(m.column)];if(!finite(v)||v<0)continue;const map=history.get(m.column);if(!map.has(d))map.set(d,[]);map.get(d).push({minute,value:v,timestamp:t});}
 }
 for(const [t,v]of ga4){if(typeof t!=='string'||!finite(v)||v<0)continue;const d=t.slice(0,10),minute=Number(t.slice(11,13))*60+Number(t.slice(14,16));const map=history.get('GA4');if(!map.has(d))map.set(d,[]);map.get(d).push({minute,value:v,timestamp:t});}
 for(const map of history.values())for(const day of map.values())day.sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
 return history;
}
function usable(day,stock){if(!day?.length||day[0].minute>90||day.at(-1).minute<1410||day.length<20)return false;if(stock)return true;const final=at(day,1440);if(!finite(final)||final<=0)return false;let high=0;for(const p of day){if(p.value<high-Math.max(2,high*.02))return false;high=Math.max(high,p.value);}return true;}
export function profile(history,m,date,method='median14'){
 const window=Number(method.match(/\d+/)?.[0]??14),all=history.get(m.column)??new Map();
 let days=[...all.keys()].filter(d=>d<date&&dayNumber(date)-dayNumber(d)<=window&&!EXCLUDED_DAYS.has(d)&&usable(all.get(d),m.stock)).sort();
 if(method==='previous')days=days.slice(-1);
 if(days.length<(method==='previous'?1:Math.min(5,window)))return null;
 const weights=days.map(d=>method==='weekday28'?(weekday(d)===weekday(date)?3:([0,6].includes(weekday(d))===[0,6].includes(weekday(date))?1.5:0.5))*Math.exp(-(dayNumber(date)-dayNumber(d))/21):1);
 const values=Array.from({length:49},(_,i)=>{
  const samples=days.flatMap((d,j)=>{const day=all.get(d),v=at(day,i*30,m.stock?10:45),last=at(day,1440);return finite(v)?[{v:m.stock?v:v/last,w:weights[j]}]:[];});
  if(samples.length<(method==='previous'?1:3))return null;
  return method==='mean14'?samples.reduce((n,x)=>n+x.v*x.w,0)/samples.reduce((n,x)=>n+x.w,0):weightedMedian(samples);
 });
 if(values.filter(finite).length<12)return null;
 if(!m.stock){let max=0;for(let i=0;i<values.length;i++){if(finite(values[i])){max=Math.max(max,Math.min(1,values[i]));values[i]=max;}}values[48]=1;}
 if(method==='blend14'){const prior=profile(history,m,date,'previous');if(prior)for(let i=0;i<49;i++)if(finite(values[i])&&finite(prior.values[i]))values[i]=.5*values[i]+.5*prior.values[i];}
 return{method,values,days:days.length,dates:days};
}
export function interpolate(values,minute){const p=Math.min(48,Math.max(0,minute/30)),i=Math.min(47,Math.floor(p)),f=p-i;return f===0?values[i]:finite(values[i])&&finite(values[i+1])?values[i]*(1-f)+values[i+1]*f:null;}
export function predict(p,current,anchor,future,{stock=false,alpha=.5,scale=1}={}){
 if(!p||!finite(current)||future<anchor)return null;if(future===anchor)return current;
 const base=interpolate(p.values,anchor),target=interpolate(p.values,future);if(!finite(base)||!finite(target)||base<=0)return null;
 if(!stock)return Math.max(current,current*target/base);
 const model=target*Math.max(.25,Math.min(4,1+alpha*(scale-1))),ramp=Math.min(1,(future-anchor)/60);return Math.max(0,current*(1-ramp)+model*ramp);
}
export function currentContext(history,m,date,anchor,p){
 const day=history.get(m.column)?.get(date),current=at(day,anchor,m.stock?10:45);if(!finite(current))return null;
 let scale=1;
 if(m.stock&&p.method==='previous'){scale=current/interpolate(p.values,anchor);}
 else if(m.stock){const points=day.filter(x=>x.minute<=anchor&&x.minute>=anchor-60),actual=points.reduce((n,x)=>n+x.value,0),expected=points.reduce((n,x)=>n+interpolate(p.values,x.minute),0);if(!points.length||expected<=0)return null;scale=actual/expected;}
 return{current,scale};
}
export function evaluate(history,m,date,method,{alpha=.5}={}){
 const all=history.get(m.column),day=all?.get(date);if(EXCLUDED_DAYS.has(date)||!usable(day,m.stock))return [];
 const p=method==='baseline'?null:profile(history,m,date,method);if(method!=='baseline'&&!p)return [];
 const prior=new Date((dayNumber(date)-1)*86400000).toISOString().slice(0,10),previous=all.get(prior),out=[];
 for(const anchor of ANCHORS){
  const current=at(day,anchor,m.stock?10:45);if(!finite(current))continue;
  const horizons=m.stock?[anchor+60,anchor+180,anchor+360,1435].filter((h,i,a)=>h<=1435&&a.indexOf(h)===i):[1440];
  for(const horizon of horizons){const actual=at(day,horizon,m.stock?10:45);if(!finite(actual))continue;let forecast;
   if(method==='baseline'){const base=at(previous,anchor,m.stock?10:45),future=at(previous,horizon,m.stock?10:45);if(!finite(base)||base<=0||!finite(future))continue;forecast=current*future/base;}
   else{const context=currentContext(history,m,date,anchor,p);if(!context)continue;forecast=predict(p,current,anchor,horizon,{stock:m.stock,alpha,scale:context.scale});}
   if(finite(forecast))out.push({date,anchor,horizon,actual,forecast,ae:Math.abs(forecast-actual)});
  }
 }
 return out;
}
export const score=rows=>rows.length?{n:rows.length,wape:rows.reduce((n,r)=>n+r.ae,0)/Math.max(1,rows.reduce((n,r)=>n+r.actual,0)),mae:rows.reduce((n,r)=>n+r.ae,0)/rows.length}:null;
export function selectMethod(history,m,date){
 const dates=[...history.get(m.column).keys()].filter(d=>d<date&&dayNumber(date)-dayNumber(d)<=12&&!EXCLUDED_DAYS.has(d)).sort();
 const candidates=METHODS.flatMap(method=>(m.stock?(method==='previous'?[1]:[.25,.5,1]):[.5]).map(alpha=>({method,alpha,validation:score(dates.flatMap(d=>evaluate(history,m,d,method,{alpha})))}))).filter(c=>c.validation?.n>=8);
 candidates.sort((a,b)=>a.validation.wape-b.validation.wape);
 return candidates[0]??{method:'previous',alpha:1,validation:null};
}
export function backtest(history,{start='2026-11-21',end='2026-11-26'}={}){
 return METRICS.map(m=>{const days=[...history.get(m.column).keys()].filter(d=>d>=start&&d<=end&&!EXCLUDED_DAYS.has(d)).sort(),old=[],improved=[];
  for(const date of days){const choice=selectMethod(history,m,date),a=evaluate(history,m,date,'baseline'),b=evaluate(history,m,date,choice.method,choice);for(const row of a){const match=b.find(r=>r.anchor===row.anchor&&r.horizon===row.horizon);if(match){old.push(row);improved.push(match);}}}
  return{column:m.column,row:m.row,baseline:score(old),improved:score(improved)};
 });
}


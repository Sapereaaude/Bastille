/* Moteur v2 tel que présent dans index.html avant la refonte (commit 38dc611). Référence figée pour les tests de non-régression. */
/* ---- moteur de matching v2 (pur, testable hors navigateur) ----
   Hiérarchie : mesure → famille → thème → score du parti.
   Chaque parti a un score indépendant 0–100 %, jamais normalisé. */
const COMPAT={contre:0,neutre:50,pour:75,adore:100}; /* choix de modélisation, documenté dans « Comment on calcule ? » */
const REL_T={firstN:16,firstThemes:4,firstParties:4,consN:32,consThemes:7,consParties:7,consMin:3,stable:5,gapStable:0};
const FAM=(P,i)=>P[i][6]||('m'+i);              /* famille : champ 6, sinon la mesure est sa propre famille */
const ALSO=(P,i)=>P[i][7]||[];                   /* partis engagés sur une mesure strictement identique */
const partiesOf=(P,i)=>[P[i][2],...ALSO(P,i)];
const corpusOf=(P,k)=>P.map((_,i)=>i).filter(i=>partiesOf(P,i).includes(k));
function partyScore(P,A,k){
  const th={};const ev=[];
  Object.keys(A).forEach(i=>{i=+i;const a=A[i];if(!(a in COMPAT)||!P[i]||!partiesOf(P,i).includes(k))return;ev.push(i);const t=P[i][0],f=FAM(P,i);th[t]=th[t]||{};(th[t][f]=th[t][f]||[]).push(COMPAT[a])});
  const themes=Object.keys(th);if(!themes.length)return null;
  const mean=v=>v.reduce((a,b)=>a+b,0)/v.length;
  const tm={};themes.forEach(t=>{tm[t]=mean(Object.values(th[t]).map(mean))});
  const raw=mean(Object.values(tm));
  return {k,raw,pct:Math.round(raw),comp:ev.length,ok:ev.filter(i=>A[i]==='pour'||A[i]==='adore').length,no:ev.filter(i=>A[i]==='contre').length,fire:ev.filter(i=>A[i]==='adore').length,neu:ev.filter(i=>A[i]==='neutre').length,themes:themes.length,th:tm,corpus:corpusOf(P,k).length,cover:ev.length/Math.max(1,corpusOf(P,k).length)}}
const MINEVAL=2; /* un parti avec moins de 2 mesures évaluées est classé après les autres (affiché grisé) */
function engScores(P,A){const ks=[...new Set(P.map(p=>p[2]))];return ks.map(k=>partyScore(P,A,k)).filter(Boolean).sort((a,b)=>((b.comp>=MINEVAL)-(a.comp>=MINEVAL))||b.raw-a.raw||b.comp-a.comp||b.fire-a.fire)}
/* fiabilité : exploratoire / à confirmer / consolidé — seuils documentés dans REL_T, à calibrer */
function engReliability(P,A,hist){
  const ev=Object.keys(A).map(Number).filter(i=>(A[i] in COMPAT)&&P[i]);const n=ev.length;
  const themes=new Set(ev.map(i=>P[i][0])).size;const sc=engScores(P,A);const parties=sc.filter(x=>x.comp>=REL_T.consMin).length;const partiesAny=sc.length;
  const h=hist||[];const last=h.slice(-REL_T.stable);const stable=last.length>=REL_T.stable&&last.every(x=>x===last[0]);
  const miss=[];if(n<REL_T.firstN)miss.push(`${REL_T.firstN-n} réponse${REL_T.firstN-n>1?'s':''} de plus`);if(themes<REL_T.firstThemes)miss.push(`${REL_T.firstThemes-themes} thème${REL_T.firstThemes-themes>1?'s':''} de plus`);if(partiesAny<REL_T.firstParties)miss.push(`des mesures de ${REL_T.firstParties-partiesAny} parti${REL_T.firstParties-partiesAny>1?'s':''} de plus`);
  let lvl='explo';if(n>=REL_T.firstN&&themes>=REL_T.firstThemes&&partiesAny>=REL_T.firstParties)lvl='confirm';
  if(lvl==='confirm'&&n>=REL_T.consN&&themes>=REL_T.consThemes&&parties>=REL_T.consParties&&stable)lvl='consol';
  return {lvl,n,themes,parties,partiesAny,stable,miss,label:{explo:'Exploratoire',confirm:'À confirmer',consol:'Consolidé'}[lvl]}}
/* sélection des cartes : équilibre partis, thèmes, familles, instruments ; après le 1er pronostic, complète ce qui manque */
function engPick(P,A,order,rand,mech,twins){
  const seen=new Set(order);const rem=P.map((_,i)=>i).filter(i=>!seen.has(i));if(!rem.length)return null;
  const cnt=(f)=>{const m={};order.forEach(i=>{const v=f(i);m[v]=(m[v]||0)+1});return m};
  const cp=cnt(i=>P[i][2]),ct=cnt(i=>P[i][0]),cf=cnt(i=>FAM(P,i)),cm=cnt(i=>mech?mech[i]:'');
  const recent=order.slice(-6);const tw=twins||[];
  const evP={},evT={};Object.keys(A).forEach(i=>{i=+i;if(!(A[i] in COMPAT)||!P[i])return;evP[P[i][2]]=(evP[P[i][2]]||0)+1;evT[P[i][0]]=(evT[P[i][0]]||0)+1});
  const unlocked=Object.keys(A).filter(i=>A[i] in COMPAT).length>=REL_T.firstN;
  let best=null,bs=Infinity;
  rem.forEach(i=>{const k=P[i][2],t=P[i][0];let s=(cp[k]||0)*3+(ct[t]||0)*2+(cf[FAM(P,i)]||0)*4+(cm[mech?mech[i]:'']||0)*0.5;
    if(unlocked)s+=(evP[k]||0)*2+(evT[t]||0)*1.5;
    if(tw.some(([a,b])=>(a===i&&recent.includes(b))||(b===i&&recent.includes(a))))s+=6;
    s+=rand()*0.9;if(s<bs){bs=s;best=i}});
  return best}


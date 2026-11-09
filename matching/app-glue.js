/* ---- raccord v3 ↔ jeu : propositions neutres validées ajoutées au deck (BMX injecté par build.mjs) ---- */
const P0=P.length;                                   /* mesures d'origine ; au-delà : propositions communes */
const P0I=()=>P.slice(0,P0).map((_,i)=>i);           /* mini-jeux : uniquement les mesures d'origine */
const BM=BastilleMatching;
const BM_MODEL=BM.buildModel(P,BMX);
const BM_ROW={};
BMX.propositions.forEach(p=>{const i=P.length;
  P.push([p.theme,p.texte_carte,p.lead,p.id.replace(/^BP-/,''),p.citations.map(c=>'« '+c.texte+' »').join(' · '),'',p.famille,p.also]);
  PSIMPLE.push([p.texte_simple,p.explication_simple]);STANCE.push([p.stance,'pas '+p.stance]);
  SRCM.push(['Proposition commune Bastille',p.citations.map(c=>c.reference).join(' ; '),'',(p.citations[0]||{}).url||'']);
  DUMECA.push(DUMECA[p.mesuresApp[0]]||'D');BM.attachRow(BM_MODEL,i,p.id);BM_ROW[p.id]=i});
const BM_DECK=BM.deckRows(BM_MODEL);                 /* lignes jouables : mesures non rattachées + propositions validées */
const DECKN=()=>BM_DECK.length;
const BMP=i=>i>=P0?BMX.propositions[i-P0]:null;
const SUPP=i=>{const u=BM_MODEL.units[BM_MODEL.rowUnit[i]];return u?Object.keys(u.pos).filter(k=>u.pos[k]==='SUPPORT'):[P[i][2],...(P[i][7]||[])]};
const CNI=i=>i>=P0?SUPP(i).map(k=>CN(k)).join(' et '):CN(P[i][2]);
const UAN=()=>BM.unitAnswers(BM_MODEL,S.answers);
const BM_COMMON=BMX.propositions.filter(p=>Object.values(p.positions).filter(s=>s==='SUPPORT'||s==='OPPOSE').length>=2).length;
/* anciens noms du moteur v2, gardés pour les écrans qui les utilisent */
const COMPAT=BM.COMPAT;const REL_T=BM.REL;const MINEVAL=BM.MINEVAL;
const FAM=(P_,i)=>{const u=BM_MODEL.units[BM_MODEL.rowUnit[i]];return u?u.famille:('m'+i)};
const ALSO=(P_,i)=>P[i][7]||[];
const partiesOf=(P_,i)=>SUPP(i);
const corpusOf=(P_,k)=>BM_DECK.filter(i=>SUPP(i).includes(k));
/* réponses sauvegardées : ré-ancrées sur la proposition (u) ; une mesure devenue proposition commune repart à zéro */
function bmSanitize(){S.answers=(S.answers||[]).map(x=>{if(x.u&&String(x.u).startsWith('BP-'))return BM_ROW[x.u]!=null?Object.assign({},x,{i:BM_ROW[x.u]}):null;if(!(x.i in BM_MODEL.rowUnit))return null;return x}).filter(Boolean);S.order=S.answers.map(x=>x.i);S.i=S.order.length}
/* « Comment on calcule ? » : ce qui dépend des propositions communes, des nuances et de la documentation */
function bmHow(sc,r){const top=sc[0];const nu=sc.slice(0,3).flatMap(x=>x.nuances.map(n=>({k:x.k,n})));
  const docs=sc.slice(0,4).map(x=>`${CN(x.k)} : ${x.corpus} proposition${x.corpus>1?'s':''} documentée${x.corpus>1?'s':''}`).join(' · ');
  const nl=s=>s==='PARTIAL'?'d\'accord en partie, sous conditions':'même objectif, modalités différentes';
  return `<details style="margin-top:10px"><summary class="anton" style="font-size:17px;cursor:pointer">Plusieurs partis, un seul swipe</summary><div style="margin-top:6px">${BM_COMMON?`<b>${BM_COMMON}</b> proposition${BM_COMMON>1?'s':''} commune${BM_COMMON>1?'s':''} validée${BM_COMMON>1?'s':''} : quand tu swipes l'une d'elles, ta réponse compte pour <b>chaque</b> parti qui la défend, et à l'envers pour celui qui s'y oppose explicitement. Une seule fois chacun.`:'Pour l\'instant, aucune proposition commune n\'est validée : chaque carte compte encore pour le seul parti qui l\'a écrite. Les propositions communes arrivent après relecture humaine de chaque rapprochement.'}<br><br>Si un programme ne dit rien sur une proposition, ce parti n'est ni récompensé ni pénalisé : sa position est « inconnue » et ne compte pas. Ne rien dire, ce n'est pas s'opposer.</div></details>
  <details style="margin-top:10px"><summary class="anton" style="font-size:17px;cursor:pointer">Les nuances</summary><div style="margin-top:6px">Quand un parti est d'accord en partie, ou vise le même but avec d'autres modalités (montant, âge, calendrier), on ne lui donne pas 50 % par défaut : on ne compte rien, et on te propose une carte plus précise pour trancher.${nu.length?`<br><br>Dans tes réponses : ${nu.slice(0,4).map(({k,n})=>`${CN(k)}, ${nl(n.stance)}`).join(' ; ')}.`:''}</div></details>
  <details style="margin-top:10px"><summary class="anton" style="font-size:17px;cursor:pointer">Pourquoi des partis plus documentés</summary><div style="margin-top:6px">Certains programmes sont plus longs, ou ont plus de mesures déjà vérifiées dans Bastille. Chaque score est une moyenne par thème, pas une somme : publier plus ne rapporte pas plus de points, ça donne juste plus d'occasions d'être comparé.${docs?`<br><br>${docs}.`:''}</div></details>
  <details style="margin-top:10px"><summary class="anton" style="font-size:17px;cursor:pointer">Pourquoi c'est provisoire</summary><div style="margin-top:6px">Le pourcentage dit à quel point tu es d'accord ; la fiabilité dit à quel point on peut s'y fier. Ce n'est pas la même chose.${top&&top.margin!=null?`<br><br>${CN(top.k)} : ${top.pct} %, à ±${top.margin} points près (marge indicative, calculée sur ${top.comp} proposition${top.comp>1?'s':''}).`:''}${r.tiesWithTop.length?`<br><br>Égalité statistique avec ${r.tiesWithTop.map(k=>CN(k)).join(', ')} : l'écart avec ton n°1 tient dans la marge.`:''}${r.dominantTheme&&r.dominantShare>BM.REL.maxThemeShare?`<br><br>Plus de la moitié de tes réponses portent sur un seul thème (${T[r.dominantTheme][0].toLowerCase()}) : le résultat ne représente pas l'ensemble de tes idées.`:''}<br><br>Données : ${r.documented} positions documentées dans tes ${r.n} réponses${BM_COMMON?`, dont ${r.commonAnswered} proposition${r.commonAnswered>1?'s':''} commune${r.commonAnswered>1?'s':''}`:''}. Les programmes ne sont pas encore couverts en entier.</div></details>`}

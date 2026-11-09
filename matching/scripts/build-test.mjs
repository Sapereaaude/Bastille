#!/usr/bin/env node
// Environnement de test : Bastille avec TOUTES les propositions validables activées (sans validation humaine)
// + un panneau 🧪 qui montre, carte par carte, pour quels partis le swipe compte.
// Sortie : matching/test/bastille-test.html. Jamais déployé comme version officielle.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAll } from './build.mjs';
import { loadData, compile } from '../lib/compile.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MX = path.join(ROOT, 'matching');

export function validateAllForTest(d) {
  const v = { ...d.validations };
  for (const p of d.propositions) if (p.statut !== 'en_attente_source') v[p.id] = v[p.id] || { statut: 'valide' };
  for (const c of d.correspondances) if (c.type !== 'piste') v[c.id] = v[c.id] || { statut: 'valide' };
  for (const x of d.positions) if (x.position !== 'UNKNOWN') v[x.id] = v[x.id] || { statut: 'valide' };
  // Les décisions « rejeté » ou « à revoir » prises par l'humaine sont respectées.
  return { ...d, validations: v };
}

const PANEL = `
/* ---- 🧪 environnement de test (ajouté par build-test.mjs) ---- */
(()=>{const st=document.createElement('style');st.textContent=\`
#tst-pill{position:fixed;left:10px;bottom:10px;z-index:9999;background:#D7372B;color:#fff;border:2px solid #17171F;font:800 12px/1 Figtree,system-ui,sans-serif;letter-spacing:.06em;padding:8px 11px;box-shadow:3px 3px 0 #17171F;cursor:pointer;white-space:nowrap}
#tst-panel{position:fixed;left:10px;bottom:50px;z-index:9999;width:min(340px,calc(100vw - 20px));max-height:min(70vh,560px);overflow:auto;background:#fff;color:#17171F;border:2px solid #17171F;box-shadow:4px 4px 0 #17171F;font:500 12.5px/1.4 Figtree,system-ui,sans-serif;padding:10px 12px;display:none}
#tst-panel.on{display:block}#tst-panel b{font-weight:800}#tst-panel h4{margin:10px 0 4px;font:800 11px/1.2 Figtree,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#5E6170}
#tst-panel .r{display:flex;gap:6px;align-items:baseline;margin:2px 0}#tst-panel .r span:first-child{flex:1;min-width:0}
#tst-panel .s{font-weight:800;font-size:10.5px;padding:1px 5px;border:1.5px solid #17171F;white-space:nowrap}
#tst-panel .SUPPORT{background:#2B4BB8;color:#fff;border-color:#2B4BB8}#tst-panel .OPPOSE{background:#D7372B;color:#fff;border-color:#D7372B}#tst-panel .PARTIAL,#tst-panel .DIFFERENT{background:#FFF1D6;border-color:#B26A00}
#tst-panel .note{color:#5E6170;font-size:11.5px;margin-top:6px}#tst-panel button{font:800 11px Figtree,sans-serif;border:2px solid #17171F;background:#fff;padding:4px 8px;margin:8px 6px 0 0;cursor:pointer}\`;document.head.appendChild(st);
const pill=document.createElement('button');pill.id='tst-pill';pill.textContent='🧪 TEST';document.body.appendChild(pill);
const pn=document.createElement('div');pn.id='tst-panel';document.body.appendChild(pn);
pill.onclick=()=>{pn.classList.toggle('on');draw()};
const NM=k=>C[k]?C[k].s+' ('+C[k].party+')':k;
const LB={SUPPORT:'soutient',OPPOSE:'s\\'oppose',PARTIAL:'partiel',DIFFERENT:'modalités ≠',UNKNOWN:'inconnu'};
function card(i){if(i==null)return '<div class="note">Pas de carte en cours.</div>';const u=BM_MODEL.units[BM_MODEL.rowUnit[i]];if(!u)return '';
  const rows=Object.entries(u.pos).map(([k,s])=>'<div class="r"><span>'+NM(k)+'</span><span class="s '+s+'">'+LB[s]+'</span></div>').join('');
  return '<div><b>'+(u.common?'Proposition commune '+u.id:'Mesure d\\'origine n° '+P[i][3])+'</b> · famille <i>'+u.famille+'</i></div>'+rows+(u.common?'':'<div class="note">Mesure non rattachée : compte pour son seul auteur (comme avant).</div>')}
function draw(){if(!pn.classList.contains('on'))return;let cur=null;try{cur=(curId==='s-swipe'&&S.i<DECKN())?curM():null}catch(e){}
  const last=S.answers[S.answers.length-1];const sc=scores().slice(0,5);const r=reliability();
  pn.innerHTML='<div><b>Environnement de test</b> — toutes les propositions validables sont activées, même sans relecture. Rien ici n\\'est la version officielle.</div>'
   +'<h4>Carte en cours</h4>'+card(cur)
   +'<h4>Dernier swipe</h4>'+(last?'<div>« '+String(P[last.i][1]).replace(/\\|/g,' ')+' » → <b>'+last.a+'</b></div>'+card(last.i):'<div class="note">Aucun.</div>')
   +'<h4>Scores</h4>'+(sc.length?sc.map(x=>'<div class="r"><span>'+NM(x.k)+'</span><span><b>'+x.pct+'\u00a0%</b>'+(x.margin!=null?' ±'+x.margin:'')+' · '+x.comp+' prop.'+(x.nuances.length?' · '+x.nuances.length+' nuance(s)':'')+(x.tieWithTop?' · égalité':'')+'</span></div>').join(''):'<div class="note">Pas encore de score.</div>')
   +'<h4>Fiabilité</h4><div>'+r.label+' · '+r.n+' rép. · '+r.themes+' thèmes · thème dominant '+Math.round(r.dominantShare*100)+' %'+(r.miss.length?'<br>Manque : '+r.miss.join(', '):'')+'</div>'
   +'<div class="note">'+BMX.propositions.length+' propositions neutres actives · '+DECKN()+' cartes dans le deck.</div>'
   +'<button id="tst-reset">Recommencer à zéro</button>';
  const b=document.getElementById('tst-reset');if(b)b.onclick=()=>{try{localStorage.clear()}catch(e){}location.reload()}}
setInterval(draw,500);})();
`;

export function buildTest() {
  const d = loadData(path.join(MX, 'data'));
  const comp = compile(validateAllForTest(d));
  const appData = { propositions: comp.propositions.map(({ detailPositions, question, nuances, niveau_precision, ...p }) => p) };
  let html = buildAll().newHtml.replace(/const BMX=.*?;\n/, `const BMX=${JSON.stringify(appData)};\n`);
  const end = '\n})();\n</script>\n</body>';
  if (!html.includes(end)) throw new Error('fin de script introuvable');
  html = html.replace(end, '\n' + PANEL + end);
  html = html.replace(/<title>([^<]*)<\/title>/, '<title>🧪 TEST · $1</title>');
  // Sauvegardes séparées de la vraie app, même sur la même origine.
  html = html.replace("const KEY='bastille-v2-reel';", "const KEY='bastille-test-v3';");
  return { html, count: comp.propositions.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { html, count } = buildTest();
  fs.mkdirSync(path.join(MX, 'test'), { recursive: true });
  fs.writeFileSync(path.join(MX, 'test', 'bastille-test.html'), html);
  console.log(`matching/test/bastille-test.html : ${count} propositions actives (mode test).`);
}

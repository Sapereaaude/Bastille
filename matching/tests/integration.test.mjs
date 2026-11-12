// Intégration : charge index.html dans jsdom et joue des parties complètes.
// Deux configurations : données réelles (0 validation) et toutes les propositions validables validées.
// Nécessite jsdom (devDependency) ; le test est ignoré s'il n'est pas installé.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildAll } from '../scripts/build.mjs';
import { compile, loadData } from '../lib/compile.mjs';
import { ROOT } from './helpers.mjs';

let JSDOM = null, VirtualConsole = null;
try { ({ JSDOM, VirtualConsole } = await import('jsdom')); } catch { /* ignoré */ }

function validateAll(d) {
  const v = {};
  for (const p of d.propositions) if (p.statut !== 'en_attente_source') v[p.id] = { statut: 'valide' };
  for (const c of d.correspondances) if (c.type !== 'piste') v[c.id] = { statut: 'valide' };
  for (const x of d.positions) if (x.position !== 'UNKNOWN') v[x.id] = { statut: 'valide' };
  return { ...d, validations: v };
}

// L'app est encapsulée dans une IIFE : on y glisse un point d'accès de test (copie en mémoire uniquement).
const HOOK = (html) => { const out = html.replace(/\n\}\)\(\);\n<\/script>\n<\/body>/, '\nwindow.__T=s=>eval(s);\n})();\n</script>\n</body>'); assert.notEqual(out, html, 'point d\'accès de test non injecté'); return out; };

function boot(html, storage) {
  html = HOOK(html);
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => { const m = String(e.stack || e); if (!/Not implemented/.test(m)) errors.push(m.slice(0, 800)); });
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole,
    beforeParse(w) {
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
      w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = function () {};
      if (storage) for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
    },
  });
  return { w: dom.window, errors, ev: (s) => dom.window.__T(s) };
}

// Joue n cartes, ouvre les écrans principaux et quelques mini-jeux ; renvoie l'état utile.
function play(ctx, n, mode = 'light') {
  const { ev } = ctx;
  if (mode === 'dark') ev('S.dark=true');
  ev("show('s-swipe',startSwipe)");
  const A = ['pour', 'contre', 'adore', 'neutre', 'pour', 'passe', 'contre'];
  for (let k = 0; k < n; k++) ev(`busy=false;if(S.i<DECKN()){answer(${JSON.stringify(A[k % A.length])})};busy=false;renderDeck();updateMeta()`);
  const screens = ['renderResults()', 'openHow()', 'closeHow()', "show('s-detail',renderDetail)", "show('s-profile',renderProfile)", 'renderMenu()', 'startDevine()', 'startPari()', 'startPeau();peauDeck(SIX()[0])', 'startDeep()', 'startWrap()', 'openInfo(S.answers[0].i,true)', 'closeInfo()'];
  const failed = [];
  for (const s of screens) { try { ev(s); } catch (e) { failed.push(s + ' → ' + e.message); } }
  return { failed, state: JSON.parse(ev('JSON.stringify({i:S.i,deck:DECKN(),P:P.length,P0,answers:S.answers,unlocked:S.unlocked,scores:scores(),rel:reliability(),how:document.querySelector("#how-body").textContent,resData:document.querySelector("#res-data").textContent,resDataShown:document.querySelector("#res-data").style.display!=="none"})')) };
}

test('app : données réelles (aucune validation) — partie complète sans erreur, comportement v2 conservé', { skip: !JSDOM && 'jsdom absent' }, () => {
  const newHtml = buildAll().newHtml.replace(/const BMX=.*?;\n/, 'const BMX={"propositions":[]};\n');
  const ctx = boot(newHtml);
  const r = play(ctx, 30);
  assert.deepEqual(r.failed, []); assert.deepEqual(ctx.errors, []);
  assert.equal(r.state.P, r.state.P0, 'aucune ligne ajoutée');
  assert.equal(r.state.deck, r.state.P0, 'deck = toutes les mesures');
  assert.equal(r.state.unlocked, true);
  assert.ok(r.state.resDataShown, 'données insuffisantes signalées');
  assert.match(r.state.resData, /Données partielles/);
  assert.match(r.state.how, /aucune proposition commune n'est validée/);
  for (const s of r.state.scores) assert.ok(s.pct >= 0 && s.pct <= 100);
});

test('app : premier match à 15 réponses seulement si la couverture suffit', { skip: !JSDOM && 'jsdom absent' }, () => {
  const { newHtml } = buildAll();
  const ctx = boot(newHtml);
  ctx.ev("show('s-swipe',startSwipe)");
  for (let k = 0; k < 14; k++) ctx.ev("busy=false;answer('pour');busy=false;renderDeck();updateMeta()");
  assert.equal(ctx.ev('S.unlocked'), false);
  ctx.ev("busy=false;answer('pour');busy=false;renderDeck();updateMeta()");
  const rel = JSON.parse(ctx.ev('JSON.stringify(reliability())'));
  assert.equal(ctx.ev('S.unlocked'), rel.lvl !== 'explo');
  assert.deepEqual(ctx.errors, []);
});

test('app : propositions communes validées — un swipe compte pour les deux partis, mesures doublons retirées du deck', { skip: !JSDOM && 'jsdom absent' }, () => {
  const built = buildAll();
  const comp = compile(validateAll(loadData(path.join(ROOT, 'matching', 'data'))));
  const appData = { propositions: comp.propositions.map(({ detailPositions, question, nuances, niveau_precision, ...p }) => p) };
  const html = built.newHtml.replace(/const BMX=.*?;\n/, `const BMX=${JSON.stringify(appData)};\n`);
  assert.ok(comp.propositions.length > 20);
  for (const mode of ['light', 'dark']) {
    const ctx = boot(html);
    const r = play(ctx, 140, mode);
    assert.deepEqual(r.failed, [], mode); assert.deepEqual(ctx.errors, [], mode);
    assert.equal(r.state.P, r.state.P0 + comp.propositions.length);
    const excluded = new Set(comp.propositions.flatMap((p) => p.mesuresApp));
    assert.equal(r.state.deck, r.state.P0 - excluded.size + comp.propositions.length);
    assert.equal(r.state.i, r.state.deck, 'deck entièrement joué');
    assert.ok(r.state.answers.every((a) => !excluded.has(a.i)), 'aucune mesure rattachée servie en double');
    // La carte EPR2 compte pour LFI (M) et les Écologistes (T).
    const epr = JSON.parse(ctx.ev("JSON.stringify((()=>{const i=BM_ROW['BP-ENV-001'];return {i,sup:SUPP(i),txt:P[i][1]}})())"));
    assert.deepEqual(epr.sup.sort(), ['M', 'T']);
    assert.match(r.state.how, /propositions? communes? validées?/);
  }
});

test('app : sauvegarde ancienne (v2) restaurée sans perte ni plantage', { skip: !JSDOM && 'jsdom absent' }, () => {
  const built = buildAll();
  const comp = compile(validateAll(loadData(path.join(ROOT, 'matching', 'data'))));
  const appData = { propositions: comp.propositions.map(({ detailPositions, question, nuances, niveau_precision, ...p }) => p) };
  const html = built.newHtml.replace(/const BMX=.*?;\n/, `const BMX=${JSON.stringify(appData)};\n`);
  // Sauvegarde v2 : 20 réponses, dont certaines sur des mesures aujourd'hui rattachées (62 = LFI nucléaire, 100 = ECO nucléaire).
  const answers = [62, 100, 0, 1, 2, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 17, 18, 19, 20, 21].map((i, k) => ({ i, a: ['pour', 'contre', 'adore'][k % 3] }));
  const save = JSON.stringify({ answers, i: 20, order: answers.map((x) => x.i), unlocked: true, matched: false, themes: [], intent: null, topHist: [], seed: 3 });
  const ctx = boot(html, { 'bastille-v2-reel': save });
  const st = JSON.parse(ctx.ev('JSON.stringify({n:S.answers.length,i:S.i,order:S.order.length,has62:S.answers.some(x=>x.i===62)})'));
  assert.equal(st.has62, false, 'réponse sur une mesure devenue proposition commune : retirée');
  assert.equal(st.n, 18); assert.equal(st.i, 18); assert.equal(st.order, 18);
  const r = play(ctx, 5);
  assert.deepEqual(r.failed, []); assert.deepEqual(ctx.errors, []);
});

test('app : décisions réelles du dépôt — partie complète sans erreur, propositions validées jouables', { skip: !JSDOM && 'jsdom absent' }, () => {
  const { newHtml, compiled } = buildAll();
  const ctx = boot(newHtml);
  const r = play(ctx, 140);
  assert.deepEqual(r.failed, []); assert.deepEqual(ctx.errors, []);
  assert.equal(r.state.P, r.state.P0 + compiled.propositions.length);
  for (const p of compiled.propositions) {
    const sup = JSON.parse(ctx.ev(`JSON.stringify(SUPP(BM_ROW[${JSON.stringify(p.id)}]))`)).sort();
    assert.deepEqual(sup, Object.keys(p.positions).filter((k) => p.positions[k] === 'SUPPORT').sort(), p.id);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { BM, loadV2, lcg, row } from './helpers.mjs';
import { extractAppData } from '../scripts/import-app.mjs';
import { html } from './helpers.mjs';

const APP = extractAppData(html());
const P = APP.P;
const ANS = ['contre', 'neutre', 'pour', 'adore', 'passe'];

// Modèle de test : deux partis A et B, propositions communes, enfants de précision, nuances.
const compiled = (props) => ({ propositions: props.map((p) => ({ famille: p.id, parent: null, mesuresApp: [], ...p })) });
const modelOf = (props, rows = []) => {
  const m = BM.buildModel(rows, compiled(props));
  props.forEach((p, j) => BM.attachRow(m, 1000 + j, p.id));
  return m;
};

test('non-régression : sans proposition validée, les scores v3 sont identiques aux scores v2 (600 sessions)', () => {
  const v2 = loadV2(P); const model = BM.buildModel(P, null); const r = lcg(7);
  for (let s = 0; s < 600; s++) {
    const A = {}; const n = 1 + Math.floor(r() * P.length);
    for (let j = 0; j < n; j++) A[Math.floor(r() * P.length)] = ANS[Math.floor(r() * ANS.length)];
    const answers = Object.entries(A).map(([i, a]) => ({ i: +i, a }));
    const a = v2.engScores(P, A), b = BM.scores(model, BM.unitAnswers(model, answers));
    assert.equal(b.length, a.length);
    a.forEach((x, i) => {
      for (const f of ['k', 'pct', 'comp', 'ok', 'no', 'fire', 'neu', 'themes', 'corpus']) assert.equal(b[i][f], x[f], `session ${s}, rang ${i}, champ ${f}`);
      assert.ok(Math.abs(b[i].raw - x.raw) < 1e-9);
    });
  }
});

test('non-régression : sans proposition validée, la sélection des cartes suit v2 à seuil égal', () => {
  const v2 = loadV2(P); const model = BM.buildModel(P, null);
  for (const seed of [1, 42, 999, 123456]) {
    const ra = lcg(seed), rb = lcg(seed); const oa = [], ob = [], A = {}, ans = []; const pick = lcg(seed + 1);
    for (let step = 0; step < 40; step++) {
      const x = v2.engPick(P, A, oa, ra, APP.DUMECA ?? null, []);
      const y = BM.pick(model, BM.unitAnswers(model, ans), ob, rb, { mech: null, twins: [], rel: { firstN: 16 } });
      assert.equal(y, x, `graine ${seed}, carte ${step}`);
      oa.push(x); ob.push(y); const a = ANS[Math.floor(pick() * 4)]; A[x] = a; ans.push({ i: x, a });
    }
  }
});

test('proposition commune : un swipe profite à tous les partis qui la soutiennent, une seule fois chacun', () => {
  const m = modelOf([{ id: 'EPR2', theme: 'env', positions: { A: 'SUPPORT', B: 'SUPPORT' } }]);
  const sc = BM.scores(m, { EPR2: 'pour' });
  assert.deepEqual(sc.map((x) => [x.k, x.pct, x.comp, x.common]).sort(), [['A', 75, 1, 1], ['B', 75, 1, 1]]);
});

test('UNKNOWN : ni récompensé ni pénalisé (absence ≠ opposition)', () => {
  const props = [
    { id: 'P1', theme: 'env', positions: { A: 'SUPPORT', B: 'UNKNOWN' } },
    { id: 'P2', theme: 'log', positions: { A: 'SUPPORT', B: 'SUPPORT' } },
  ];
  const m = modelOf(props);
  const withUnknown = BM.scores(m, { P1: 'adore', P2: 'pour' }).find((x) => x.k === 'B');
  const without = BM.scores(m, { P2: 'pour' }).find((x) => x.k === 'B');
  assert.equal(withUnknown.pct, without.pct);
  assert.equal(withUnknown.comp, 1);
  assert.equal(withUnknown.unknown, 1);
  // Un parti seulement UNKNOWN n'a pas de score du tout.
  const m2 = modelOf([{ id: 'P1', theme: 'env', positions: { A: 'SUPPORT', B: 'UNKNOWN' } }]);
  assert.deepEqual(BM.scores(m2, { P1: 'contre' }).map((x) => x.k), ['A']);
});

test('OPPOSE : compatibilité miroir, et le désaccord est compté', () => {
  const m = modelOf([{ id: 'NUC', theme: 'env', positions: { A: 'SUPPORT', B: 'OPPOSE' } }]);
  const sc = BM.scores(m, { NUC: 'contre' });
  const a = sc.find((x) => x.k === 'A'), b = sc.find((x) => x.k === 'B');
  assert.equal(a.pct, 0); assert.equal(a.no, 1);
  assert.equal(b.pct, 100); assert.equal(b.ok, 1);
  const sc2 = BM.scores(m, { NUC: 'adore' });
  assert.equal(sc2.find((x) => x.k === 'B').pct, 0);
  assert.equal(sc2.find((x) => x.k === 'B').no, 1);
});

test('retraites : carte générique commune, carte 60 ans/40 annuités distincte, PARTIAL jamais à 50 %', () => {
  const props = [
    { id: 'R-ABROGER', theme: 'tra', famille: 'retraite', positions: { LFI: 'SUPPORT', ECO: 'SUPPORT' } },
    { id: 'R-60', theme: 'tra', famille: 'retraite', parent: 'R-ABROGER', positions: { LFI: 'SUPPORT', ECO: 'PARTIAL' } },
    { id: 'R-62', theme: 'tra', famille: 'retraite', parent: 'R-ABROGER', positions: { LFI: 'DIFFERENT', ECO: 'SUPPORT' } },
  ];
  const m = modelOf(props);
  // L'utilisateur veut revenir sur la réforme ET partir à 60 ans/40 annuités.
  const sc = BM.scores(m, { 'R-ABROGER': 'pour', 'R-60': 'adore' });
  const lfi = sc.find((x) => x.k === 'LFI'), eco = sc.find((x) => x.k === 'ECO');
  assert.equal(lfi.comp, 2); assert.equal(lfi.pct, Math.round((75 + 100) / 2));
  assert.equal(eco.comp, 1, 'la position PARTIAL ne compte pas'); assert.equal(eco.pct, 75);
  assert.deepEqual(eco.nuances.map((n) => [n.unit, n.stance]), [['R-60', 'PARTIAL']]);
  // Pas de 50 % implicite : la réponse « j'adore » sur R-60 n'a pas tiré ECO vers 50 ni vers 100.
  assert.notEqual(eco.pct, Math.round((75 + 50) / 2));
  // La famille commune évite de tripler le poids du sujet « retraites ».
  const withHousing = { 'R-ABROGER': 'adore', 'R-60': 'adore', 'R-62': 'adore' };
  const m2 = modelOf([...props, { id: 'LOG', theme: 'log', positions: { LFI: 'SUPPORT', ECO: 'SUPPORT' } }]);
  const s2 = BM.scores(m2, { ...withHousing, LOG: 'contre' }).find((x) => x.k === 'ECO');
  assert.equal(s2.pct, 50, 'thème retraites (100) et logement (0) pèsent autant');
});

test('SMIC : accord reconnu sur le principe, divergence sur le montant signalée sans points', () => {
  const props = [
    { id: 'SMIC-HAUSSE', theme: 'eco', famille: 'smic', positions: { A: 'SUPPORT', B: 'SUPPORT' } },
    { id: 'SMIC-2000', theme: 'eco', famille: 'smic', parent: 'SMIC-HAUSSE', positions: { A: 'SUPPORT', B: 'DIFFERENT' } },
  ];
  const m = modelOf(props);
  const sc = BM.scores(m, { 'SMIC-HAUSSE': 'pour', 'SMIC-2000': 'pour' });
  const a = sc.find((x) => x.k === 'A'), b = sc.find((x) => x.k === 'B');
  assert.equal(a.ok, 2); assert.equal(b.ok, 1, 'accord sur le principe seulement');
  assert.equal(b.nuances.length, 1); assert.equal(b.nuances[0].stance, 'DIFFERENT');
  assert.equal(a.pct, 75); assert.equal(b.pct, 75);
});

test('relance de précision : après une carte à nuances, la carte enfant passe devant', () => {
  const props = [
    { id: 'PARENT', theme: 'eco', famille: 'f1', positions: { A: 'SUPPORT', B: 'PARTIAL' } },
    { id: 'CHILD', theme: 'eco', famille: 'f1', parent: 'PARENT', positions: { A: 'SUPPORT', B: 'OPPOSE' } },
    ...['sec', 'log', 'san', 'edu', 'imm'].map((t) => ({ id: 'X-' + t, theme: t, positions: { A: 'SUPPORT' } })),
  ];
  const m = modelOf(props);
  const rows = { PARENT: 1000, CHILD: 1001 };
  const next = BM.pick(m, { PARENT: 'pour' }, [rows.PARENT], () => 0, {});
  assert.equal(next, rows.CHILD);
  // Sans nuance sur le parent, pas de relance : la diversité thématique reprend la main.
  const m2 = modelOf(props.map((p) => p.id === 'PARENT' ? { ...p, positions: { A: 'SUPPORT', B: 'SUPPORT' } } : p));
  assert.notEqual(BM.pick(m2, { PARENT: 'pour' }, [1000], () => 0, {}), 1001);
});

test('formulations proches : une même proposition répondue deux fois ne compte qu\'une fois', () => {
  const m = BM.buildModel([], compiled([{ id: 'U', theme: 'env', positions: { A: 'SUPPORT' } }]));
  BM.attachRow(m, 5, 'U'); BM.attachRow(m, 6, 'U');
  const UA = BM.unitAnswers(m, [{ i: 5, a: 'pour' }, { i: 6, a: 'contre' }]);
  assert.deepEqual(UA, { U: 'contre' });
  assert.equal(BM.scores(m, UA)[0].comp, 1);
});

test('déséquilibre des programmes : publier plus de mesures n\'avantage pas mécaniquement', () => {
  const props = [];
  for (let j = 0; j < 10; j++) props.push({ id: 'A' + j, theme: ['eco', 'log'][j % 2], famille: 'a' + j, positions: { A: 'SUPPORT' } });
  props.push({ id: 'B0', theme: 'eco', positions: { B: 'SUPPORT' } }, { id: 'B1', theme: 'log', positions: { B: 'SUPPORT' } });
  const m = modelOf(props);
  const UA = Object.fromEntries(props.map((p) => [p.id, 'pour']));
  const sc = BM.scores(m, UA);
  assert.equal(sc.find((x) => x.k === 'A').pct, sc.find((x) => x.k === 'B').pct);
  assert.equal(sc.find((x) => x.k === 'A').corpus, 10); assert.equal(sc.find((x) => x.k === 'B').corpus, 2);
});

test('couverture thématique : 15 swipes sur l\'écologie ne donnent pas un résultat présenté comme représentatif', () => {
  const props = [];
  for (let j = 0; j < 15; j++) props.push({ id: 'E' + j, theme: 'env', positions: { [['A', 'B', 'C', 'D'][j % 4]]: 'SUPPORT' } });
  const m = modelOf(props);
  const r = BM.reliability(m, Object.fromEntries(props.map((p) => [p.id, 'pour'])), []);
  assert.equal(r.lvl, 'explo'); assert.equal(r.dominantTheme, 'env'); assert.equal(r.dominantShare, 1);
  assert.ok(r.miss.includes("d'autres thèmes"));
  assert.ok(r.miss.some((x) => /thèmes? de plus/.test(x)));
});

test('score ≠ confiance : même pourcentage, marge plus large avec moins de propositions évaluées', () => {
  const mk = (n) => { const ps = []; for (let j = 0; j < n; j++) ps.push({ id: 'p' + j, theme: 'eco', famille: 'f' + j, positions: { A: 'SUPPORT' } }); return ps; };
  const small = mk(4), big = mk(20);
  const ans = (ps) => Object.fromEntries(ps.map((p, j) => [p.id, j % 2 ? 'pour' : 'neutre']));
  const a = BM.scores(modelOf(small), ans(small))[0], b = BM.scores(modelOf(big), ans(big))[0];
  assert.equal(a.pct, b.pct);
  assert.ok(a.margin > b.margin, `${a.margin} > ${b.margin}`);
  const tiny = mk(2); assert.equal(BM.scores(modelOf(tiny), ans(tiny))[0].margin, null, 'moins de 3 réponses : pas de marge affichée');
  // Réponses toutes identiques : la marge ne tombe pas à zéro (plancher).
  const same = BM.scores(modelOf(big), Object.fromEntries(big.map((p) => [p.id, 'pour'])))[0];
  assert.ok(same.margin >= Math.round(1.96 * BM.SD_FLOOR / Math.sqrt(20)));
});

test('égalité statistique : un écart dans la marge n\'est pas présenté comme un écart réel', () => {
  const props = [];
  for (let j = 0; j < 6; j++) props.push({ id: 'a' + j, theme: ['eco', 'log', 'san'][j % 3], famille: 'a' + j, positions: { A: 'SUPPORT', B: j < 5 ? 'SUPPORT' : 'UNKNOWN' } });
  const sc = BM.scores(modelOf(props), Object.fromEntries(props.map((p, j) => [p.id, j === 5 ? 'adore' : 'pour'])));
  assert.equal(sc[0].k, 'A'); assert.equal(sc[1].tieWithTop, true);
});

test('départage : après le premier match, une carte sur deux, si les positions diffèrent — la couverture reste prioritaire', () => {
  const props = [];
  for (let j = 0; j < 17; j++) props.push({ id: 'c' + j, theme: ['eco', 'log', 'san', 'edu'][j % 4], famille: 'c' + j, positions: { A: 'SUPPORT', B: 'SUPPORT' } });
  props.push({ id: 'SAME', theme: 'eco', famille: 'same', positions: { A: 'SUPPORT', B: 'SUPPORT' } });   // 1017
  props.push({ id: 'SPLIT', theme: 'eco', famille: 'split', positions: { A: 'SUPPORT', B: 'OPPOSE' } }); // 1018
  const m = modelOf(props);
  const seen = (n) => props.slice(0, n).map((_, j) => 1000 + j);
  const UA = (n) => Object.fromEntries(props.slice(0, n).map((p) => [p.id, 'pour']));
  // 16 cartes vues (nombre pair), A et B à égalité : la carte qui les sépare passe devant.
  const pool16 = { ...m, rowUnit: Object.fromEntries(Object.entries(m.rowUnit).filter(([r]) => +r !== 1016)) };
  assert.equal(BM.pick(pool16, UA(16), seen(16), () => 0, {}), 1018);
  // 17 cartes vues (impair) : pas de départage, les deux cartes sont à égalité et la première l'emporte.
  assert.equal(BM.pick(m, UA(17), seen(17), () => 0, {}), 1017);
  // Avant le premier match (moins de 15 réponses) : jamais de départage.
  const pool10 = { ...m, rowUnit: Object.fromEntries(Object.entries(m.rowUnit).filter(([r]) => +r >= 1017 || +r < 1010)) };
  assert.equal(BM.pick(pool10, UA(10), seen(10), () => 0, {}), 1017);
  // Couverture prioritaire : une carte d'un thème jamais vu passe devant la carte de départage.
  const m2 = modelOf([...props, { id: 'NEW', theme: 'int', famille: 'new', positions: { A: 'SUPPORT', B: 'SUPPORT' } }]);
  const pool2 = { ...m2, rowUnit: Object.fromEntries(Object.entries(m2.rowUnit).filter(([r]) => +r !== 1016)) };
  assert.equal(BM.pick(pool2, UA(16), seen(16), () => 0, {}), 1019);
});

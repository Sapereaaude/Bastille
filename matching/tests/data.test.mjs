import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, html } from './helpers.mjs';
import { loadData, compile, isVerified } from '../lib/compile.mjs';
import { audit } from '../lib/audit.mjs';
import { extractAppData, buildMeasures, diffVersions } from '../scripts/import-app.mjs';
import { parseCSV, importRows } from '../scripts/import-csv.mjs';
import { fingerprint } from '../lib/normalize.mjs';

const DIR = path.join(ROOT, 'matching', 'data');
const fresh = () => loadData(DIR);
const valid = (...ids) => Object.fromEntries(ids.map((id) => [id, { statut: 'valide' }]));

test('traçabilité : chaque texte original est la citation de l\'app, mot pour mot (guillemets externes retirés)', () => {
  const app = extractAppData(html());
  const d = fresh();
  for (const m of d.mesures.filter(isVerified)) {
    const raw = app.P[m.origine.index_app][4];
    assert.ok(raw.includes(m.texte_original), m.id);
    assert.equal(raw.replace(/^\s*«\s*/, '').replace(/\s*»\s*$/, ''), m.texte_original, m.id);
    assert.equal(m.empreinte, fingerprint(m.texte_original));
    assert.ok(m.url && (m.reference || m.page), `${m.id} : référence`);
  }
  assert.equal(d.mesures.filter(isVerified).length, 24);
});

test('traçabilité : un texte modifié entre deux imports est détecté et l\'ancienne version conservée', () => {
  const d = fresh(); const prev = d.mesures.map((m) => ({ ...m }));
  const next = d.mesures.map((m) => ({ ...m }));
  next[0] = { ...next[0], texte_original: next[0].texte_original + ' (modifié)', empreinte: 'x' };
  const ch = diffVersions(prev, next, '2026-12-01');
  assert.equal(ch.length, 1); assert.equal(ch[0].type, 'texte_modifie');
  assert.equal(next[0].versions_precedentes[0].texte_original, prev[0].texte_original);
});

test('aucune validation : rien n\'entre dans le calcul', () => {
  assert.equal(compile(fresh()).propositions.length, 0);
});

test('validation partielle : une proposition sans ses positions validées reste hors calcul', () => {
  const d = { ...fresh(), validations: valid('BP-ENV-001', 'COR-001', 'COR-003') };
  const c = compile(d);
  assert.equal(c.propositions.length, 0);
  assert.ok(c.avertissements.some((w) => /BP-ENV-001/.test(w)));
});

test('validation complète d\'une proposition commune : les deux partis, les deux mesures sorties du deck', () => {
  const d = { ...fresh(), validations: valid('BP-ENV-001', 'COR-001', 'COR-003', 'POS-ENV-001-LFI', 'POS-ENV-001-ECO') };
  const c = compile(d);
  assert.equal(c.propositions.length, 1);
  const p = c.propositions[0];
  assert.deepEqual(p.positions, { M: 'SUPPORT', T: 'SUPPORT' });
  assert.deepEqual(p.mesuresApp.sort((a, b) => a - b), [62, 100]);
  // Les fragments « fermeture des centrales » et « SMR » ne sont pas validés : signalés comme perdus.
  assert.ok(c.avertissements.some((w) => /LFI-0063 sort du deck/.test(w)));
});

test('une piste (mesure sans texte original) ne peut jamais entrer dans le calcul, même validée', () => {
  const d = fresh();
  const pisteCor = d.correspondances.find((c) => c.type === 'piste' && c.proposition === 'BP-ECO-001');
  const v = valid('BP-ECO-001', pisteCor.id, 'POS-ECO-001-LFI');
  const c = compile({ ...d, validations: v });
  assert.equal(c.propositions.length, 0);
});

test('une proposition en attente de source reste exclue même si elle est validée', () => {
  const d = fresh();
  const ids = ['BP-INS-004', ...d.correspondances.filter((c) => c.proposition === 'BP-INS-004').map((c) => c.id), ...d.positions.filter((x) => x.proposition === 'BP-INS-004').map((x) => x.id)];
  assert.equal(compile({ ...d, validations: valid(...ids) }).propositions.length, 0);
});

test('une position UNKNOWN validée ne produit aucune entrée de position', () => {
  const d = fresh();
  const v = valid('BP-ENV-003', 'COR-005', 'POS-ENV-003-ECO', 'POS-ENV-003-LFI');
  const c = compile({ ...d, validations: v });
  assert.deepEqual(c.propositions[0].positions, { T: 'SUPPORT' });
});

test('une position SUPPORT citée doit s\'appuyer sur une mesure reliée à la proposition', () => {
  const d = fresh();
  const fake = { ...d, positions: d.positions.map((x) => x.id === 'POS-ENV-001-ECO' ? { ...x, mesures: ['ECO-0004'] } : x), validations: valid('BP-ENV-001', 'COR-001', 'COR-003', 'POS-ENV-001-LFI', 'POS-ENV-001-ECO') };
  const c = compile(fake);
  assert.deepEqual(c.propositions[0].positions, { M: 'SUPPORT' });
  assert.ok(audit(fake).some((f) => f.code === 'POS_PREUVE_NON_RELIEE' && f.cible === 'POS-ENV-001-ECO'));
});

test('audit : repère positions déduites, rapprochements ambigus, pistes, versions, sources inaccessibles', () => {
  const F = audit(fresh());
  const has = (code, cible) => F.some((f) => f.code === code && (!cible || String(f.cible).includes(cible)));
  assert.ok(has('POS_DEDUITE', 'POS-TRA-001-LFI'));
  assert.ok(has('COR_AMBIGUE'));
  assert.ok(has('COR_PISTE'));
  assert.ok(has('PROP_SANS_SOURCE', 'BP-INS-004'));
  assert.ok(has('VERSION_PROGRAMME', 'LFI-'));
  assert.ok(has('SOURCE_INACCESSIBLE'));
  assert.ok(has('REL_AMBIGUE'));
  assert.ok(!has('POS_SANS_PREUVE'), 'toute position documentée cite une mesure vérifiée');
  assert.ok(!has('POS_MANQUANTE'), 'chaque proposition a une position (même UNKNOWN) pour chaque parti du périmètre');
});

test('audit : une position sans preuve et une proposition redondante sont signalées', () => {
  const d = fresh();
  const bad = { ...d,
    positions: [...d.positions, { id: 'POS-X', proposition: 'BP-SAN-001', parti: 'ECO', position: 'SUPPORT', mesures: [], pistes: [], preuve: 'aucune', justification: '', ecarts: {} }],
    propositions: [...d.propositions, { ...d.propositions.find((p) => p.id === 'BP-SAN-001'), id: 'BP-SAN-099' }] };
  const F = audit(bad);
  assert.ok(F.some((f) => f.code === 'POS_SANS_PREUVE' && f.cible === 'POS-X'));
  assert.ok(F.some((f) => f.code === 'PROP_REDONDANTE' && f.cible.includes('BP-SAN-099')));
});

test('neutralité : aucune formulation ne reprend le vocabulaire partisan des programmes', () => {
  const PARTISAN = /révolution fiscale|grandes? fortunes?|mutilant|bifurcation|réforme Borne|insoumis|écologie punitive|casseurs|ultra-riches|islamo|wokisme|assistanat/i;
  for (const p of fresh().propositions) for (const f of ['question', 'texte_carte', 'texte_simple', 'explication_simple']) assert.ok(!PARTISAN.test(p[f]), `${p.id}.${f} : « ${p[f]} »`);
});

test('neutralité : aucun nom de parti ni de candidat dans les cartes', () => {
  const d = fresh(); const names = Object.values(d.partis).flatMap((p) => [p.nom, p.candidat, ...p.candidat.split(' ')]).filter((x) => x.length > 3);
  for (const p of d.propositions) for (const n of names) assert.ok(!p.texte_carte.includes(n) && !p.question.includes(n), `${p.id} cite ${n}`);
});

test('import CSV : texte intact, doublons ignorés, correspondances CSV jamais validées, lignes incomplètes refusées', () => {
  const d = fresh();
  const csv = 'parti;texte;page;thème;url;proposition\n'
    + 'LFI;« Garantir le droit du sol intégral à tous les enfants nés en France »;12;Immigration;https://exemple.invalid;BP-IMM-001\n'
    + 'ECO;Texte d’essai avec apostrophe typographique — et tiret cadratin;;Santé;https://exemple.invalid;BP-SAN-001\n'
    + 'ECO;;;Santé;;\n'
    + 'PS;Une mesure;;Santé;;\n';
  const res = importRows(parseCSV(csv), d.partis, d.mesures, 'essai.csv');
  // La ligne LFI reprend une mesure déjà importée (LFI-0016) : doublon, non réimportée.
  assert.equal(res.added.length, 1); assert.equal(res.skipped.length, 1);
  assert.equal(res.added[0].texte_original, 'Texte d’essai avec apostrophe typographique — et tiret cadratin');
  assert.equal(res.added[0].correspondance_preliminaire.statut, 'preliminaire_csv');
  assert.equal(res.added[0].verification.statut, 'reference_incomplete');
  assert.ok(res.problems.some((p) => /texte original vide/.test(p.probleme)));
  assert.ok(res.problems.some((p) => /parti inconnu/.test(p.probleme)));
  // Une mesure importée par CSV n'est pas « vérifiée » : elle ne peut pas servir de preuve.
  assert.equal(isVerified(res.added[0]), false);
  // Ré-import du même fichier : tout est doublon.
  const again = importRows(parseCSV(csv), d.partis, [...d.mesures, ...res.added], 'essai.csv');
  assert.equal(again.added.length, 0);
});

test('extension : ajouter un parti ne demande aucun changement d\'architecture', () => {
  const app = extractAppData(html());
  const partis = { ...fresh().partis, RE: { nom: 'Renaissance', candidat: 'Gabriel Attal', cle_app: 'A', programmes: [], dans_le_perimetre: true } };
  const ms = buildMeasures(app, partis, '2026-11-09');
  assert.ok(ms.filter((m) => m.parti === 'RE').length >= 9);
  const F = audit({ ...fresh(), partis, mesures: ms });
  assert.ok(F.some((f) => f.code === 'POS_MANQUANTE' && /RE/.test(f.message)), 'le nouveau parti est signalé comme non documenté');
});

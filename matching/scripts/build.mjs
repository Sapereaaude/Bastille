#!/usr/bin/env node
// Build de la couche de matching :
//  1. compile les données validées (lib/compile.mjs) → data/compiled.json
//  2. audit + détection automatique + rapport de couverture → reports/
//  3. injecte moteur + données validées + raccord dans index.html (entre les marqueurs BASTILLE-MATCHING)
//  4. génère l'interface d'audit autonome matching/audit.html
// --check : n'écrit rien, échoue si index.html ou audit.html ne sont pas à jour.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData, compile, isVerified } from '../lib/compile.mjs';
import { audit, summarize } from '../lib/audit.mjs';
import { detectCandidates, internalDuplicates, recallAgainstManual } from '../lib/detect.mjs';
import { coverageData, coverageMarkdown } from '../lib/coverage.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MX = path.join(ROOT, 'matching');
const START = '/* <BASTILLE-MATCHING v3> */', END = '/* </BASTILLE-MATCHING v3> */';

export function buildAll({ today = new Date().toISOString().slice(0, 10) } = {}) {
  const d = loadData(path.join(MX, 'data'));
  const compiled = compile(d);
  const changesFile = path.join(MX, 'reports', 'changements.json');
  const lastChanges = fs.existsSync(changesFile) ? (JSON.parse(fs.readFileSync(changesFile, 'utf8')).at(-1)?.changements ?? []) : [];
  const findings = audit(d, lastChanges);
  const candidates = detectCandidates(d.mesures);
  const detection = { candidates, internal: internalDuplicates(d.mesures), recall: recallAgainstManual(candidates, d.correspondances, d.mesures) };
  const cov = coverageData(d, compiled, findings, detection);
  const md = coverageMarkdown(d, cov, today);

  const engine = fs.readFileSync(path.join(MX, 'engine.js'), 'utf8');
  const glue = fs.readFileSync(path.join(MX, 'app-glue.js'), 'utf8');
  const appData = { propositions: compiled.propositions.map(({ detailPositions, question, nuances, niveau_precision, ...p }) => p) };
  const block = `${START}\n${engine.trim()}\nconst BMX=${JSON.stringify(appData)};\n${glue.trim()}\n${END}`;
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const a = html.indexOf(START), b = html.indexOf(END);
  if (a < 0 || b < 0) throw new Error('Marqueurs BASTILLE-MATCHING absents de index.html');
  const newHtml = html.slice(0, a) + block + html.slice(b + END.length);

  const auditPayload = {
    genere_le: today, partis: d.partis, sources: d.sources, mesures: d.mesures, propositions: d.propositions, relations: d.relations,
    positions: d.positions, correspondances: d.correspondances, validations: d.validations,
    verifiees: d.mesures.filter(isVerified).map((m) => m.id), constats: findings, resume: summarize(findings),
    compile: { retenues: compiled.propositions.map((p) => p.id), avertissements: compiled.avertissements },
    detection: { candidats: candidates.slice(0, 40), internes: detection.internal, rappel: detection.recall }, couverture_md: md,
  };
  const tpl = fs.readFileSync(path.join(MX, 'audit.template.html'), 'utf8');
  const auditHtml = tpl.replace('/*__AUDIT_DATA__*/null', JSON.stringify(auditPayload).replace(/</g, '\\u003c'));
  return { d, compiled, findings, detection, md, newHtml, auditHtml, html };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const r = buildAll();
  const auditPath = path.join(MX, 'audit.html');
  if (check) {
    const stale = [];
    if (r.newHtml !== r.html) stale.push('index.html');
    if (!fs.existsSync(auditPath) || fs.readFileSync(auditPath, 'utf8').replace(/"genere_le":"[^"]*"/, '') !== r.auditHtml.replace(/"genere_le":"[^"]*"/, '')) stale.push('matching/audit.html');
    if (stale.length) { console.error('Pas à jour :', stale.join(', '), '→ lancer npm run matching:build'); process.exit(1); }
    console.log('Build à jour.'); process.exit(0);
  }
  fs.writeFileSync(path.join(ROOT, 'index.html'), r.newHtml);
  fs.writeFileSync(auditPath, r.auditHtml);
  fs.writeFileSync(path.join(MX, 'data', 'compiled.json'), JSON.stringify(r.compiled, null, 1) + '\n');
  fs.writeFileSync(path.join(MX, 'reports', 'couverture.md'), r.md);
  fs.writeFileSync(path.join(MX, 'reports', 'audit.json'), JSON.stringify({ resume: summarize(r.findings), constats: r.findings }, null, 1) + '\n');
  fs.writeFileSync(path.join(MX, 'reports', 'candidats-auto.json'), JSON.stringify(r.detection, null, 1) + '\n');
  console.log(`Propositions retenues pour le calcul : ${r.compiled.propositions.length}`);
  console.log('Constats d\'audit :', summarize(r.findings));
  r.compiled.avertissements.forEach((w) => console.log('  ⚠︎', w));
}

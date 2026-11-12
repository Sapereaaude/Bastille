#!/usr/bin/env node
// Import niveau 1 depuis les CSV Bastille (séparateur , ou ; détecté).
// Usage : node matching/scripts/import-csv.mjs fichier.csv [--dry]
// - En-têtes reconnus en français ou en anglais (voir ALIASES). Colonnes inconnues conservées dans « extra ».
// - Le texte original est stocké tel quel (aucune correction, aucune normalisation).
// - Toute colonne de correspondance (proposition, parti_similaire…) est importée comme « preliminaire_csv » :
//   elle n'est JAMAIS considérée comme validée.
// - Doublons (même parti + même texte normalisé) : signalés et non réimportés.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint, isExcerpt, normalize, themeKey } from '../lib/normalize.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = path.join(ROOT, 'matching', 'data');

export const ALIASES = {
  id: ['id', 'identifiant', 'code'],
  parti: ['parti', 'party', 'formation'],
  texte_original: ['texte_original', 'texte', 'mesure', 'citation', 'original', 'text'],
  reference: ['reference', 'référence', 'ref', 'section', 'chapitre'],
  page: ['page', 'p'],
  theme: ['theme', 'thème', 'categorie', 'catégorie'],
  sous_theme: ['sous_theme', 'sous-thème', 'sous theme', 'sous_thème', 'subtheme'],
  url: ['url', 'lien', 'source', 'document'],
  date_document: ['date', 'date_document'],
  version: ['version', 'edition', 'édition'],
  statut: ['statut', 'statut_verification', 'verification', 'vérification'],
  reformulation_bastille: ['reformulation', 'reformulation_bastille', 'texte_bastille'],
  correspondance: ['proposition', 'proposition_neutre', 'correspondance', 'match', 'equivalent', 'équivalent', 'mesure_similaire'],
};

export function parseCSV(text) {
  const t = text.replace(/^﻿/, '');
  const firstLine = t.split(/\r?\n/, 1)[0];
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

export function mapHeaders(header) {
  const map = {};
  header.forEach((h, i) => {
    const n = normalize(h).replace(/ /g, '_');
    for (const [k, al] of Object.entries(ALIASES)) if (al.some((a) => normalize(a).replace(/ /g, '_') === n)) { map[i] = k; return; }
    map[i] = 'extra:' + h.trim();
  });
  return map;
}

export function importRows(rows, partis, existing, sourceName) {
  const [header, ...body] = rows; const map = mapHeaders(header);
  const known = new Set(existing.map((m) => m.parti + '|' + normalize(m.texte_original ?? m.reformulation_bastille)));
  const ids = new Set(existing.map((m) => m.id));
  const partyIds = Object.fromEntries(Object.entries(partis).flatMap(([id, p]) => [[normalize(id), id], [normalize(p.nom), id], [normalize(p.cle_app), id]]));
  const added = [], skipped = [], problems = [];
  body.forEach((r, n) => {
    const rec = { extra: {} };
    r.forEach((v, i) => { const k = map[i]; if (k.startsWith('extra:')) { if (v.trim()) rec.extra[k.slice(6)] = v; } else rec[k] = v; });
    const line = n + 2;
    const parti = partyIds[normalize(rec.parti)];
    if (!parti) { problems.push({ ligne: line, probleme: `parti inconnu « ${rec.parti ?? ''} »` }); return; }
    const texte = rec.texte_original ?? '';
    if (!texte.trim()) { problems.push({ ligne: line, probleme: 'texte original vide : mesure non importée (jamais de texte reconstitué)' }); return; }
    const key = parti + '|' + normalize(texte);
    if (known.has(key)) { skipped.push({ ligne: line, raison: 'doublon (même parti, même texte normalisé)' }); return; }
    let id = rec.id?.trim() || `${parti}-CSV${String(added.length + 1).padStart(3, '0')}`;
    while (ids.has(id)) id += 'b';
    ids.add(id); known.add(key);
    const theme = themeKey(rec.theme ?? '');
    if (!theme) problems.push({ ligne: line, probleme: `thème non reconnu « ${rec.theme ?? ''} » (à classer)` });
    const hasRef = !!(rec.reference || rec.page) && !!rec.url;
    added.push({
      id, parti, programme: null,
      texte_original: texte, texte_extrait: isExcerpt(texte), empreinte: fingerprint(texte),
      reference: rec.reference || null, page: rec.page ? +String(rec.page).replace(/\D/g, '') || null : null,
      titre_document: null, theme, sous_theme: rec.sous_theme || null, sous_theme_origine: rec.sous_theme ? 'csv' : null,
      url: rec.url || null, date_document: rec.date_document || null, version: rec.version || null,
      reformulation_bastille: rec.reformulation_bastille || null,
      verification: { statut: hasRef ? 'a_verifier' : 'reference_incomplete', source: `CSV ${sourceName}`, statut_declare_csv: rec.statut || null, revérifiée_ici: false },
      correspondance_preliminaire: rec.correspondance ? { valeur: rec.correspondance, statut: 'preliminaire_csv' } : null,
      origine: { type: 'csv', fichier: sourceName, ligne: line }, extra: rec.extra,
    });
  });
  return { added, skipped, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2]; if (!file) { console.error('Usage : import-csv.mjs fichier.csv [--dry]'); process.exit(1); }
  const { partis } = JSON.parse(fs.readFileSync(path.join(DATA, 'partis.json'), 'utf8'));
  const mf = path.join(DATA, 'mesures.json'); const doc = JSON.parse(fs.readFileSync(mf, 'utf8'));
  const res = importRows(parseCSV(fs.readFileSync(file, 'utf8')), partis, doc.mesures, path.basename(file));
  console.log(`ajoutées : ${res.added.length} · doublons ignorés : ${res.skipped.length} · problèmes : ${res.problems.length}`);
  res.problems.forEach((p) => console.log(`  ligne ${p.ligne} : ${p.probleme}`));
  if (!process.argv.includes('--dry')) { doc.mesures.push(...res.added); fs.writeFileSync(mf, JSON.stringify(doc, null, 1) + '\n'); }
}

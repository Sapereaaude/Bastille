#!/usr/bin/env node
// Import niveau 1 : mesures originales déjà sourcées dans Bastille (index.html).
// - Jeu principal (P + SRCM) : citation mot pour mot + référence → statut « verifiee_inventaire ».
// - Jeu « Ça matche ? » (LFI, ECO) : reformulations sans citation → statut « texte_original_manquant ».
// Les textes originaux ne sont jamais réécrits ; seuls les guillemets externes « » sont retirés.
// Ré-exécuter le script détecte les changements de texte (empreinte) et les consigne.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint, isExcerpt, stripOuterQuotes, normalize } from '../lib/normalize.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = path.join(ROOT, 'matching', 'data');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

export function extractAppData(src) {
  const one = (n) => { const m = src.match(new RegExp('\\nconst ' + n + '=(.*?);\\n')); if (!m) throw new Error('constante introuvable : ' + n); return Function('return ' + m[1])(); };
  const multi = (n) => { const m = src.match(new RegExp('\\nconst ' + n + '=(\\[[\\s\\S]*?\\n\\]);')); if (!m) throw new Error('constante introuvable : ' + n); return Function('return ' + m[1])(); };
  const C = Function('return ' + src.match(/\nconst C=(\{[\s\S]*?\}\});/)[1])();
  return { P: one('P'), SRCM: one('SRCM'), LFI: multi('LFI'), ECO: multi('ECO'), C };
}

const sousThemeFromRef = (ref) => {
  if (!ref) return null;
  const dash = ref.split(/\s[–—]\s/);
  if (dash.length > 1 && !/^p\.\s*\d+$/.test(dash[dash.length - 1].trim())) return dash[dash.length - 1].trim();
  const chap = ref.match(/«\s*([^»]+?)\s*»/);
  return chap ? chap[1] : null;
};
const pageFromRef = (ref) => { const m = String(ref || '').match(/\bp\.\s*(\d+)/); return m ? +m[1] : null; };
const programmeOf = (parti, title) => parti === 'LFI' ? (/2025/.test(title) ? 'lfi-aec-2025' : 'lfi-aec-2027') : 'eco-ppe-2026';

export function buildMeasures(app, partis, today) {
  const out = [];
  const byKey = Object.fromEntries(Object.entries(partis).map(([id, p]) => [p.cle_app, id]));
  app.P.forEach((p, i) => {
    const parti = byKey[p[2]]; if (!parti) return;
    const [titre, ref, date, url] = app.SRCM[i];
    const texte = stripOuterQuotes(p[4]);
    out.push({
      id: `${parti}-${p[3]}`, parti, programme: programmeOf(parti, titre),
      texte_original: texte, texte_extrait: isExcerpt(texte), empreinte: fingerprint(texte),
      reference: ref || null, page: pageFromRef(ref), titre_document: titre,
      theme: p[0], sous_theme: sousThemeFromRef(ref), sous_theme_origine: sousThemeFromRef(ref) ? 'section_du_programme' : null,
      url: url || null, date_document: date || null,
      version: /2025/.test(titre) ? 'édition 2025' : (parti === 'ECO' ? 'juillet 2026' : null),
      reformulation_bastille: p[1].replace(/\|/g, ' '),
      verification: { statut: 'verifiee_inventaire', source: 'Inventaire de traçabilité Bastille (7 nov. 2026)', revérifiée_ici: false, note: 'Source officielle inaccessible depuis l\'environnement le 9 nov. 2026.' },
      origine: { type: 'jeu_principal', index_app: i, numero_app: p[3] },
    });
  });
  for (const [parti, arr, prog] of [['LFI', app.LFI, 'lfi-aec-2027'], ['ECO', app.ECO, 'eco-ppe-2026']]) {
    if (!partis[parti]) continue;
    arr.forEach((r, j) => out.push({
      id: `${parti}-J${String(j + 1).padStart(2, '0')}`, parti, programme: prog,
      texte_original: null, texte_extrait: null, empreinte: null,
      reference: null, page: null, titre_document: null, theme: r[0], sous_theme: null, sous_theme_origine: null,
      url: null, date_document: null, version: null,
      reformulation_bastille: r[1].replace(/\|/g, ' '), contexte_bastille: r[3],
      verification: { statut: 'texte_original_manquant', source: 'Jeu bonus « Ça matche ? » (reformulation, sans citation ni page)', revérifiée_ici: false, note: 'Piste à vérifier dans le programme officiel. N\'entre jamais dans le calcul tant que le texte original et sa référence ne sont pas saisis.' },
      origine: { type: 'jeu_ca_matche', index_jeu: j },
    }));
  }
  return out;
}

export function diffVersions(prev, next, today) {
  const old = Object.fromEntries((prev || []).map((m) => [m.id, m]));
  const changes = [];
  for (const m of next) {
    const o = old[m.id]; if (!o) continue;
    if (o.empreinte !== m.empreinte) {
      m.versions_precedentes = [...(o.versions_precedentes || []), { texte_original: o.texte_original, empreinte: o.empreinte, version: o.version, remplacee_le: today }];
      changes.push({ id: m.id, type: 'texte_modifie', avant: o.texte_original, apres: m.texte_original });
    } else if (o.versions_precedentes) m.versions_precedentes = o.versions_precedentes;
  }
  for (const id of Object.keys(old)) if (!next.find((m) => m.id === id)) changes.push({ id, type: 'mesure_disparue' });
  return changes;
}

export function findDuplicates(measures) {
  const seen = {}; const dups = [];
  for (const m of measures) {
    const t = m.texte_original ?? m.reformulation_bastille; const k = m.parti + '|' + normalize(t);
    if (seen[k]) dups.push({ id: m.id, doublon_de: seen[k] }); else seen[k] = m.id;
  }
  return dups;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const today = new Date().toISOString().slice(0, 10);
  const { partis } = JSON.parse(fs.readFileSync(path.join(DATA, 'partis.json'), 'utf8'));
  const measures = buildMeasures(extractAppData(html), partis, today);
  const file = path.join(DATA, 'mesures.json');
  const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).mesures : null;
  const changes = diffVersions(prev, measures, today);
  const dups = findDuplicates(measures);
  fs.writeFileSync(file, JSON.stringify({ _doc: 'Niveau 1 — mesures originales. Généré par scripts/import-app.mjs (+ import-csv.mjs). Ne pas modifier texte_original à la main.', genere_le: today, mesures: measures }, null, 1) + '\n');
  if (changes.length) {
    const cf = path.join(ROOT, 'matching', 'reports', 'changements.json');
    const log = fs.existsSync(cf) ? JSON.parse(fs.readFileSync(cf, 'utf8')) : [];
    log.push({ date: today, changements: changes });
    fs.writeFileSync(cf, JSON.stringify(log, null, 1) + '\n');
  }
  const by = (f) => measures.reduce((a, m) => (a[f(m)] = (a[f(m)] || 0) + 1, a), {});
  console.log('mesures importées :', measures.length, by((m) => m.parti + ' · ' + m.verification.statut));
  console.log('changements de version :', changes.length, '· doublons :', dups.length);
}

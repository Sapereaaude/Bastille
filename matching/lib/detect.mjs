// Détection automatique de mesures possiblement équivalentes (tous partis du jeu).
// Simple similarité lexicale (Jaccard sur racines) : sert à ORIENTER la relecture, jamais à valider.
import { jaccard } from './normalize.mjs';

export function detectCandidates(mesures, { seuil = 0.22, interPartisSeulement = true } = {}) {
  const txt = (m) => [m.texte_original, m.reformulation_bastille].filter(Boolean).join(' ');
  const out = [];
  for (let i = 0; i < mesures.length; i++) for (let j = i + 1; j < mesures.length; j++) {
    const a = mesures[i], b = mesures[j];
    if (interPartisSeulement && a.parti === b.parti) continue;
    const s = jaccard(txt(a), txt(b));
    if (s >= seuil) out.push({ a: a.id, b: b.id, score: +s.toFixed(3), theme_identique: a.theme === b.theme });
  }
  return out.sort((x, y) => y.score - x.score);
}

// Doublons internes à un parti : mesure citée vs piste du jeu « Ça matche ? » qui dit la même chose.
export function internalDuplicates(mesures, seuil = 0.3) {
  const out = [];
  for (const a of mesures) for (const b of mesures) {
    if (a.id >= b.id || a.parti !== b.parti) continue;
    const s = jaccard(a.texte_original ?? a.reformulation_bastille, b.texte_original ?? b.reformulation_bastille);
    const s2 = jaccard(a.reformulation_bastille ?? '', b.reformulation_bastille ?? '');
    const best = Math.max(s, s2);
    if (best >= seuil) out.push({ a: a.id, b: b.id, score: +best.toFixed(3) });
  }
  return out.sort((x, y) => y.score - x.score);
}

// Rappel : part des paires inter-partis rapprochées à la main (même proposition) retrouvées par la détection.
export function recallAgainstManual(candidates, correspondances, mesures) {
  const ids = new Set(mesures.map((m) => m.id));
  const byProp = {};
  for (const c of correspondances.filter((c) => c.type !== 'piste' && ids.has(c.mesure))) (byProp[c.proposition] = byProp[c.proposition] || new Set()).add(c.mesure);
  const pairs = new Set();
  const party = Object.fromEntries(mesures.map((m) => [m.id, m.parti]));
  for (const s of Object.values(byProp)) { const a = [...s]; for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) if (party[a[i]] !== party[a[j]]) pairs.add([a[i], a[j]].sort().join('|')); }
  const found = new Set(candidates.map((c) => [c.a, c.b].sort().join('|')));
  const hit = [...pairs].filter((p) => found.has(p));
  return { paires_manuelles: pairs.size, retrouvees: hit.length, manquees: [...pairs].filter((p) => !found.has(p)) };
}

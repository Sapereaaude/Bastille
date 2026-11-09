import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const require = createRequire(import.meta.url);
export const BM = require('../engine.js');
export const html = () => fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// Récupère le moteur v2 d'origine (référence de non-régression), figé dans tests/fixtures/engine-v2.js.
export function loadV2(P) {
  const src = fs.readFileSync(path.join(ROOT, 'matching', 'tests', 'fixtures', 'engine-v2.js'), 'utf8');
  return Function('P', src + '\nreturn {engScores,engReliability,engPick,partyScore,COMPAT,REL_T};')(P);
}

// Générateur pseudo-aléatoire déterministe (même formule que l'app).
export const lcg = (seed) => { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; };

// Jeu de mesures synthétique minimal : [thème, texte, auteur, n°, citation, exemple, famille?, autres?]
export const row = (theme, author, famille, also) => [theme, 'x', author, '0', 'q', '', famille, also];

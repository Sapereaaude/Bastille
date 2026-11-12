// Normalisation utilisée pour la détection de doublons et le rapprochement.
// Ne s'applique JAMAIS au texte original stocké : seulement aux champs dérivés.
import { createHash } from 'node:crypto';

const STOP = new Set(`a à au aux avec ce ces cet cette d de des du en et l la le les leur leurs
un une ou par pour sur dans sans plus moins ne pas que qui qu se sa son ses tout tous toute toutes
y est sont être faire mettre créer instaurer garantir assurer rendre passer porter afin ainsi
notamment dont lui elle eux nos notre vos votre cela ceci il ils elles on fin`.split(/\s+/));

export const normalize = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[’‘`´]/g, "'").replace(/[«»“”"]/g, ' ')
  .replace(/·/g, '').toLowerCase()
  .replace(/[^a-z0-9%€' -]+/g, ' ').replace(/'/g, ' ')
  .replace(/\s+/g, ' ').trim();

export const tokens = (s) => normalize(s).split(' ')
  .filter((w) => w && !STOP.has(w) && (w.length > 2 || /\d/.test(w)))
  .map((w) => w.replace(/(ations|ation|ements|ement|ments|ment|s|x)$/, '')); // racinisation grossière

export const jaccard = (a, b) => {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let n = 0; A.forEach((w) => { if (B.has(w)) n++; });
  return n / (A.size + B.size - n);
};

export const fingerprint = (s) => s == null ? null : createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 16);

// « … » ou […] : le texte stocké est un extrait, pas le texte intégral.
export const isExcerpt = (s) => /…|\[…\]|\.\.\./.test(String(s ?? ''));

// Retire uniquement les guillemets français qui encadrent la citation dans l'app.
export const stripOuterQuotes = (s) => String(s).replace(/^\s*«\s*/, '').replace(/\s*»\s*$/, '');

export const THEME_ALIASES = {
  eco: ['eco', 'economie', 'économie', 'fiscalite', 'fiscalité', 'budget'],
  sec: ['sec', 'securite', 'sécurité', 'police', 'justice'],
  imm: ['imm', 'immigration', 'nationalite', 'nationalité'],
  san: ['san', 'sante', 'santé'],
  edu: ['edu', 'education', 'éducation', 'ecole', 'école', 'enseignement'],
  env: ['env', 'environnement', 'ecologie', 'écologie', 'energie', 'énergie', 'transports'],
  log: ['log', 'logement'],
  tra: ['tra', 'travail', 'retraites', 'travail et retraites', 'emploi', 'salaires'],
  ins: ['ins', 'institutions', 'democratie', 'démocratie'],
  int: ['int', 'international', 'defense', 'défense', 'europe'],
};
export const themeKey = (label) => {
  const n = normalize(label);
  for (const [k, al] of Object.entries(THEME_ALIASES)) if (al.some((a) => normalize(a) === n)) return k;
  return null;
};

// Contrôles d'audit. Chaque constat : { code, gravite: 'bloquant'|'alerte'|'info', cible, message }.
import { jaccard, tokens } from './normalize.mjs';
import { isVerified } from './compile.mjs';

export const CHECKS = {
  PROP_SANS_SOURCE: 'Proposition sans mesure source vérifiée',
  POS_SANS_PREUVE: 'Position attribuée sans preuve citée',
  POS_DEDUITE: 'Position déduite, pas citée',
  POS_PREUVE_NON_RELIEE: 'Position SUPPORT dont la preuve n\'est pas reliée à la proposition',
  COR_AMBIGUE: 'Rapprochement douteux ou ambigu',
  COR_PISTE: 'Rapprochement fondé sur une mesure non citée',
  REL_AMBIGUE: 'Objectif commun, modalités différentes : à trancher',
  PROP_REDONDANTE: 'Propositions possiblement redondantes',
  FAMILLES_INCOHERENTES: 'Une mesure reliée à des familles différentes',
  THEME_SURREPRESENTE: 'Thème surreprésenté',
  THEME_SOUSREPRESENTE: 'Thème sous-représenté ou absent',
  PARTI_PEU_DOCUMENTE: 'Parti insuffisamment documenté',
  TEXTE_EXTRAIT: 'Texte original tronqué (extrait)',
  VERSION_PROGRAMME: 'Version du programme à vérifier',
  CHANGEMENT_VERSION: 'Texte modifié entre deux imports',
  NON_VALIDE: 'Élément non validé : exclu du calcul',
  POS_MANQUANTE: 'Parti du périmètre sans position enregistrée',
  SOURCE_INACCESSIBLE: 'Source inaccessible : extraction non exhaustive',
};

export function audit(d, changes = []) {
  const F = []; const add = (code, gravite, cible, message) => F.push({ code, titre: CHECKS[code], gravite, cible, message });
  const M = Object.fromEntries(d.mesures.map((m) => [m.id, m]));
  const ok = (id) => d.validations[id]?.statut === 'valide';
  const inScope = Object.entries(d.partis).filter(([, p]) => p.dans_le_perimetre).map(([k]) => k);

  for (const a of d.sources.acces || []) if (a.statut !== 'accessible') add('SOURCE_INACCESSIBLE', 'alerte', a.url, a.detail);

  for (const p of d.propositions) {
    const cors = d.correspondances.filter((c) => c.proposition === p.id);
    const verified = cors.filter((c) => c.type !== 'piste' && isVerified(M[c.mesure]));
    if (!verified.length) add('PROP_SANS_SOURCE', p.statut === 'en_attente_source' ? 'info' : 'bloquant', p.id, cors.length ? `Seulement des pistes non citées (${cors.map((c) => c.mesure).join(', ')}).` : 'Aucune correspondance.');
    for (const k of inScope) if (!d.positions.some((x) => x.proposition === p.id && x.parti === k)) add('POS_MANQUANTE', 'alerte', p.id, `Aucune position enregistrée pour ${k} (même UNKNOWN).`);
    if (!ok(p.id)) add('NON_VALIDE', 'info', p.id, `Proposition « ${p.question} » non validée.`);
  }

  for (const x of d.positions) {
    if (x.position === 'UNKNOWN') continue;
    const proofs = (x.mesures || []).filter((id) => isVerified(M[id]));
    if (!proofs.length) add('POS_SANS_PREUVE', 'bloquant', x.id, `${x.parti} ${x.position} sur ${x.proposition} sans mesure vérifiée.`);
    if (x.preuve === 'deduction') add('POS_DEDUITE', 'alerte', x.id, x.justification);
    const linked = d.correspondances.filter((c) => c.proposition === x.proposition && c.type !== 'piste').map((c) => c.mesure);
    if (x.position === 'SUPPORT' && x.preuve === 'citation' && !proofs.some((id) => linked.includes(id))) add('POS_PREUVE_NON_RELIEE', 'bloquant', x.id, `Preuve ${proofs.join(', ')} non reliée à ${x.proposition}.`);
    if (!ok(x.id)) add('NON_VALIDE', 'info', x.id, `${x.parti} ${x.position} sur ${x.proposition} non validée.`);
  }

  for (const c of d.correspondances) {
    if (c.ambigu) add('COR_AMBIGUE', 'alerte', c.id, `${c.mesure} → ${c.proposition} : ${c.raison_ambiguite ?? 'à examiner'}`);
    if (c.type === 'piste') add('COR_PISTE', 'info', c.id, `${c.mesure} → ${c.proposition} : texte original manquant, non validable en l'état.`);
    else if (!ok(c.id)) add('NON_VALIDE', 'info', c.id, `${c.mesure} → ${c.proposition} non validée.`);
  }
  for (const r of d.relations) if (r.statut === 'ambigu') add('REL_AMBIGUE', 'alerte', r.propositions.join(' · '), r.note);

  // Redondance : formulations très proches ou même famille avec positions identiques et même niveau de précision.
  const P = d.propositions;
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    const a = P[i], b = P[j]; const sim = jaccard(a.question, b.question);
    const posOf = (id) => d.positions.filter((x) => x.proposition === id).map((x) => x.parti + ':' + x.position).sort().join(',');
    const sameShape = a.famille === b.famille && a.niveau_precision === b.niveau_precision && posOf(a.id) === posOf(b.id) && a.parent === b.parent;
    if (sim >= 0.5 || (sameShape && sim >= 0.25)) add('PROP_REDONDANTE', 'alerte', `${a.id} · ${b.id}`, `Similarité ${sim.toFixed(2)}${sameShape ? ', même famille et mêmes positions' : ''}.`);
  }

  // Une mesure découpée en plusieurs propositions doit rester dans une seule famille (sinon son poids est multiplié).
  const famByMeasure = {};
  for (const c of d.correspondances.filter((c) => c.type !== 'piste')) {
    const p = P.find((x) => x.id === c.proposition); if (!p) continue;
    (famByMeasure[c.mesure] = famByMeasure[c.mesure] || new Set()).add(p.famille);
  }
  for (const [m, s] of Object.entries(famByMeasure)) if (s.size > 1) add('FAMILLES_INCOHERENTES', 'alerte', m, `Familles : ${[...s].join(', ')}. Acceptable si les fragments sont des décisions distinctes ; sinon regrouper.`);

  // Équilibre thématique (propositions avec au moins une source vérifiée).
  const THEMES = ['eco', 'tra', 'log', 'san', 'edu', 'env', 'sec', 'imm', 'ins', 'int'];
  const sourced = P.filter((p) => d.correspondances.some((c) => c.proposition === p.id && c.type !== 'piste' && isVerified(M[c.mesure])));
  const per = Object.fromEntries(THEMES.map((t) => [t, sourced.filter((p) => p.theme === t).length]));
  const avg = sourced.length / THEMES.length;
  for (const t of THEMES) {
    if (per[t] > 1.5 * avg) add('THEME_SURREPRESENTE', 'alerte', t, `${per[t]} propositions sourcées (moyenne ${avg.toFixed(1)}).`);
    if (per[t] < 0.5 * avg) add('THEME_SOUSREPRESENTE', 'alerte', t, `${per[t]} proposition(s) sourcée(s) (moyenne ${avg.toFixed(1)}).`);
  }

  // Documentation par parti : part des propositions où sa position est documentée (≠ UNKNOWN).
  for (const k of inScope) {
    const doc = d.positions.filter((x) => x.parti === k && x.position !== 'UNKNOWN').length;
    const share = doc / Math.max(1, P.length);
    if (share < 0.5) add('PARTI_PEU_DOCUMENTE', 'alerte', k, `Position documentée sur ${doc} propositions sur ${P.length} (${Math.round(share * 100)} %).`);
  }

  for (const m of d.mesures) if (m.texte_extrait) add('TEXTE_EXTRAIT', 'info', m.id, 'Contient « … » ou « […] » : compléter le texte intégral depuis la source.');
  const progs = d.sources.programmes;
  for (const m of d.mesures.filter((m) => m.programme && progs[m.programme] && /2025/.test(progs[m.programme].edition))) add('VERSION_PROGRAMME', 'alerte', m.id, `Citée depuis ${progs[m.programme].titre}, ${progs[m.programme].edition} ; l'édition 2027 est la référence demandée.`);
  for (const c of changes) add('CHANGEMENT_VERSION', 'bloquant', c.id, c.type === 'texte_modifie' ? `Avant : « ${c.avant} » — après : « ${c.apres} »` : 'Mesure disparue de la source.');
  return F;
}

export const summarize = (F) => F.reduce((acc, f) => { acc[f.code] = (acc[f.code] || 0) + 1; return acc; }, {});

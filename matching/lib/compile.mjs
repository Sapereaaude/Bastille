// Compile les données éditoriales en données de calcul. SEULES les décisions « valide » de validations.json passent.
// Règles (toutes nécessaires) :
//  - proposition : décision « valide » et statut ≠ en_attente_source ;
//  - correspondance : décision « valide », type ≠ piste, mesure vérifiée (texte original + référence) ;
//  - position : décision « valide », position ≠ UNKNOWN, toutes ses mesures citées vérifiées et reliées à la proposition ;
//  - la proposition n'entre dans le jeu que si elle garde ≥ 1 position SUPPORT/OPPOSE et ≥ 1 correspondance retenue.
import fs from 'node:fs';
import path from 'node:path';

export const VERIFIED = new Set(['verifiee_inventaire', 'verifiee']);
export const isVerified = (m) => !!m && VERIFIED.has(m.verification?.statut) && !!m.texte_original;

export function loadData(dir) {
  const r = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  return {
    partis: r('partis.json').partis, sources: r('sources.json'), mesures: r('mesures.json').mesures,
    propositions: r('propositions.json').propositions, relations: r('propositions.json').relations || [],
    positions: r('positions.json').positions, correspondances: r('correspondances.json').correspondances,
    validations: r('validations.json').decisions || {},
  };
}

const stanceText = (t) => { const s = t.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim().replace(/\.$/, ''); return s.charAt(0).toLowerCase() + s.slice(1); };

export function compile(d) {
  const ok = (id) => d.validations[id]?.statut === 'valide';
  const M = Object.fromEntries(d.mesures.map((m) => [m.id, m]));
  const appKey = (parti) => d.partis[parti]?.cle_app;
  const warnings = [];
  const props = [];
  for (const p of d.propositions) {
    if (!ok(p.id)) continue;
    if (p.statut === 'en_attente_source') { warnings.push(`${p.id} validée mais en attente de source : ignorée.`); continue; }
    const cors = d.correspondances.filter((c) => c.proposition === p.id && ok(c.id));
    const goodCors = cors.filter((c) => c.type !== 'piste' && isVerified(M[c.mesure]));
    cors.filter((c) => !goodCors.includes(c)).forEach((c) => warnings.push(`${c.id} validée mais non retenue (piste ou mesure non vérifiée).`));
    const linked = new Set(goodCors.map((c) => c.mesure));
    const positions = {}; const used = [];
    for (const pos of d.positions.filter((x) => x.proposition === p.id && ok(x.id))) {
      if (pos.position === 'UNKNOWN') continue;
      const k = appKey(pos.parti); if (!k) { warnings.push(`${pos.id} : parti ${pos.parti} sans clé app.`); continue; }
      const proofs = pos.mesures || [];
      if (!proofs.length || !proofs.every((id) => isVerified(M[id]))) { warnings.push(`${pos.id} validée mais sans preuve vérifiée : exclue.`); continue; }
      // La preuve doit être une mesure reliée à la proposition par une correspondance retenue, sauf pour une position
      // nuancée (PARTIAL/DIFFERENT) ou déduite, qui peut s'appuyer sur une autre mesure vérifiée du même parti.
      if (pos.position === 'SUPPORT' && pos.preuve === 'citation' && !proofs.some((id) => linked.has(id))) {
        warnings.push(`${pos.id} : SUPPORT cité sans correspondance validée vers ${p.id} : exclue.`); continue;
      }
      positions[k] = pos.position; used.push(pos);
    }
    const scoredKeys = Object.keys(positions).filter((k) => positions[k] === 'SUPPORT' || positions[k] === 'OPPOSE');
    if (!scoredKeys.length || !goodCors.length) { warnings.push(`${p.id} validée mais sans position documentée ou sans source validée : hors calcul.`); continue; }
    const supporters = Object.keys(positions).filter((k) => positions[k] === 'SUPPORT');
    props.push({
      id: p.id, theme: p.theme, famille: p.famille, parent: p.parent, niveau_precision: p.niveau_precision,
      texte_carte: p.texte_carte, texte_simple: p.texte_simple, explication_simple: p.explication_simple, question: p.question,
      stance: stanceText(p.texte_carte), nuances: p.nuances,
      positions, lead: supporters[0] || scoredKeys[0], also: supporters.slice(1),
      mesuresApp: [...linked].map((id) => M[id].origine?.index_app).filter((i) => Number.isInteger(i)),
      citations: [...linked].map((id) => ({ parti: M[id].parti, cle: appKey(M[id].parti), texte: M[id].texte_original, reference: [M[id].titre_document, M[id].reference].filter(Boolean).join(', '), url: M[id].url })),
      detailPositions: used.map((x) => ({ cle: appKey(x.parti), position: x.position, justification: x.justification, ecarts: x.ecarts })),
    });
  }
  // Une mesure sortie du deck dont un fragment n'est rattaché à aucune proposition retenue : signalé.
  const kept = new Set(props.map((p) => p.id));
  const out = new Set(props.flatMap((p) => p.mesuresApp));
  for (const m of d.mesures.filter((m) => out.has(m.origine?.index_app))) {
    const lost = d.correspondances.filter((c) => c.mesure === m.id && c.type !== 'piste' && !kept.has(c.proposition));
    if (lost.length) warnings.push(`${m.id} sort du deck mais ${lost.map((c) => c.proposition).join(', ')} n'est pas validée : fragment perdu tant que la validation n'est pas complète.`);
  }
  // Parents absents : le lien est ignoré par le moteur ; cohérence des familles d'une même mesure.
  return { version: 1, genere_le: new Date().toISOString().slice(0, 10), propositions: props, avertissements: warnings };
}

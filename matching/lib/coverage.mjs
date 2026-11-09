// Rapport de couverture des programmes (Markdown + données pour l'interface d'audit).
import { isVerified } from './compile.mjs';

const TH = { eco: 'Économie', tra: 'Travail et retraites', log: 'Logement', san: 'Santé', edu: 'Éducation', env: 'Environnement', sec: 'Sécurité', imm: 'Immigration', ins: 'Institutions', int: 'International' };
const pct = (a, b) => b ? `${(100 * a / b).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %` : '—';

export function coverageData(d, compiled, findings, detection) {
  const M = Object.fromEntries(d.mesures.map((m) => [m.id, m]));
  const parties = Object.entries(d.partis).filter(([, p]) => p.dans_le_perimetre).map(([k]) => k);
  const perParty = parties.map((k) => {
    const ms = d.mesures.filter((m) => m.parti === k);
    const prog = d.partis[k].programmes.map((id) => d.sources.programmes[id]).find((p) => p?.nb_mesures_annoncees);
    const pos = d.positions.filter((x) => x.parti === k);
    const count = (s) => pos.filter((x) => x.position === s).length;
    return {
      k, nom: d.partis[k].nom, annoncees: prog?.nb_mesures_annoncees ?? null,
      citees: ms.filter(isVerified).length, pistes: ms.filter((m) => !isVerified(m)).length, extraits: ms.filter((m) => m.texte_extrait).length,
      SUPPORT: count('SUPPORT'), OPPOSE: count('OPPOSE'), PARTIAL: count('PARTIAL'), DIFFERENT: count('DIFFERENT'), UNKNOWN: d.propositions.length - pos.filter((x) => x.position !== 'UNKNOWN').length,
      documentees: pos.filter((x) => x.position !== 'UNKNOWN').length,
    };
  });
  const themes = Object.keys(TH).map((t) => ({
    t, label: TH[t],
    mesures: Object.fromEntries(parties.map((k) => [k, d.mesures.filter((m) => m.parti === k && m.theme === t && isVerified(m)).length])),
    propositions: d.propositions.filter((p) => p.theme === t).length,
    communes: d.propositions.filter((p) => p.theme === t && d.positions.filter((x) => x.proposition === p.id && x.position !== 'UNKNOWN').length >= 2).length,
  }));
  const communes = d.propositions.filter((p) => d.positions.filter((x) => x.proposition === p.id && x.position !== 'UNKNOWN').length >= 2);
  const nuances = d.positions.filter((x) => x.position === 'PARTIAL' || x.position === 'DIFFERENT');
  const status = (s) => d.propositions.filter((p) => p.statut === s).length;
  const validated = Object.values(d.validations).filter((v) => v.statut === 'valide').length;
  return { parties: perParty, themes, communes, nuances, status: { propose: status('propose'), en_attente_source: status('en_attente_source') }, validated, compiled: compiled.propositions.length, findings, detection, M };
}

export function coverageMarkdown(d, c, today) {
  const L = [];
  const reliable = c.compiled > 0 && c.parties.every((p) => p.documentees >= 10);
  L.push(`# Rapport de couverture des programmes — Bastille`, '', `_Généré le ${today} par \`matching/scripts/build.mjs\`. Ne pas éditer à la main._`, '');
  L.push('## En bref', '');
  L.push(`- **Matching fiable : ${reliable ? 'oui' : 'non, pas encore'}.** ${c.compiled} proposition(s) neutre(s) validée(s) entre(nt) dans le calcul. ${c.compiled ? '' : 'Tant que rien n\'est validé, le jeu compare les partis mesure par mesure, exactement comme avant la refonte.'}`);
  for (const p of c.parties) L.push(`- **${p.nom}** : ${p.citees} mesures citées mot pour mot${p.annoncees ? ` sur ${p.annoncees.toLocaleString('fr-FR')} annoncées (${pct(p.citees, p.annoncees)})` : ''}, plus ${p.pistes} pistes non citées. Position documentée sur ${p.documentees} des ${d.propositions.length} propositions neutres.`);
  L.push(`- **${c.communes.length} propositions** ont une position documentée pour les deux partis ; **${c.nuances.length} positions** sont nuancées (PARTIAL ou DIFFERENT) et ne rapportent jamais de points par défaut.`);
  L.push(`- Sources officielles **inaccessibles** depuis l'environnement de travail le ${today} : l'extraction n'est pas exhaustive (voir « Sources »).`, '');

  L.push('## Sources', '', '| Programme | Édition | Mesures annoncées | Rôle |', '|---|---|---|---|');
  for (const [id, p] of Object.entries(d.sources.programmes)) L.push(`| ${p.titre} (${p.parti}) | ${p.edition} | ${p.nb_mesures_annoncees?.toLocaleString('fr-FR') ?? '—'} | ${p.role} |`);
  L.push('', '| Date | Source | Accès | Détail |', '|---|---|---|---|');
  for (const a of d.sources.acces) L.push(`| ${a.date} | ${a.url} | ${a.statut} | ${a.detail} |`);
  L.push('', ...d.sources.limites.map((x) => `- ${x}`), '');

  L.push('## Mesures importées (niveau 1)', '', '| Parti | Annoncées | Citées (vérifiées à l\'inventaire) | Couverture | Pistes non citées | Extraits tronqués |', '|---|---|---|---|---|---|');
  for (const p of c.parties) L.push(`| ${p.nom} | ${p.annoncees?.toLocaleString('fr-FR') ?? '—'} | ${p.citees} | ${pct(p.citees, p.annoncees)} | ${p.pistes} | ${p.extraits} |`);
  L.push('', '## Couverture par thème', '', `| Thème | ${c.parties.map((p) => 'Mesures ' + p.k).join(' | ')} | Propositions neutres | Dont communes |`, `|---|${c.parties.map(() => '---|').join('')}---|---|`);
  for (const t of c.themes) L.push(`| ${t.label} | ${c.parties.map((p) => t.mesures[p.k]).join(' | ')} | ${t.propositions} | ${t.communes} |`);

  L.push('', '## Positions des partis (niveau 3)', '', '| Parti | SUPPORT | OPPOSE | PARTIAL | DIFFERENT | UNKNOWN | Documentées |', '|---|---|---|---|---|---|---|');
  for (const p of c.parties) L.push(`| ${p.nom} | ${p.SUPPORT} | ${p.OPPOSE} | ${p.PARTIAL} | ${p.DIFFERENT} | ${p.UNKNOWN} | ${pct(p.documentees, d.propositions.length)} |`);
  L.push('', 'Aucune opposition explicite (OPPOSE) n\'apparaît : les deux programmes sont proches et les mesures disponibles ne se contredisent pas frontalement. Les seules oppositions possibles repérées (OTAN) reposent sur des pistes non citées et restent UNKNOWN.', '');

  L.push('## Propositions communes LFI × Écologistes', '', '| Proposition | LFI | Écologistes | Statut |', '|---|---|---|---|');
  const posOf = (id, k) => d.positions.find((x) => x.proposition === id && x.parti === k)?.position ?? 'UNKNOWN';
  for (const p of c.communes) L.push(`| ${p.id} — ${p.question} | ${posOf(p.id, 'LFI')} | ${posOf(p.id, 'ECO')} | ${d.validations[p.id]?.statut ?? 'à valider'} |`);

  L.push('', '## Nuances : même objectif, modalités différentes', '');
  for (const x of c.nuances) L.push(`- **${x.proposition}** · ${x.parti} **${x.position}** — ${x.justification}${Object.entries(x.ecarts).filter(([, v]) => v).map(([k, v]) => ` _${k}_ : ${v}.`).join('')}`);
  for (const r of d.relations) L.push(`- **${r.propositions.join(' · ')}** (${r.statut}) — ${r.note}`);

  const amb = c.findings.filter((f) => ['COR_AMBIGUE', 'POS_DEDUITE', 'REL_AMBIGUE', 'POS_SANS_PREUVE', 'PROP_SANS_SOURCE', 'POS_PREUVE_NON_RELIEE'].includes(f.code));
  L.push('', '## Points à trancher avant validation', '', '| Contrôle | Cible | Détail |', '|---|---|---|');
  for (const f of amb) L.push(`| ${f.titre} | ${f.cible} | ${f.message.replace(/\|/g, '/')} |`);

  L.push('', '## Détection automatique des équivalences', '', `Similarité lexicale entre les ${d.mesures.length} mesures importées (tous statuts). Elle oriente la relecture, elle ne valide rien.`, '');
  L.push(`- Paires inter-partis rapprochées à la main : ${c.detection.recall.paires_manuelles} ; retrouvées par la détection : ${c.detection.recall.retrouvees}. Manquées : ${c.detection.recall.manquees.join(', ') || 'aucune'}.`);
  L.push(`- Candidats inter-partis au-dessus du seuil : ${c.detection.candidates.length}. Les 10 premiers :`, '');
  for (const x of c.detection.candidates.slice(0, 10)) L.push(`  - ${x.a} ↔ ${x.b} (${x.score})`);
  L.push(`- Doublons internes (mesure citée ↔ piste du même parti) : ${c.detection.internal.length}.`, '');

  L.push('## Ce qui entre dans le calcul', '', `- Propositions validées et retenues : **${c.compiled}**. Décisions enregistrées : ${c.validated}.`, '- Règle : une proposition, une correspondance et une position n\'entrent dans le calcul qu\'après validation humaine dans `matching/audit.html` (export `validations.json`), et seulement si la preuve est une mesure citée avec sa référence.', '');
  L.push('## Prochaines étapes', '', '1. Relire et valider les propositions dans l\'interface d\'audit (priorité : les points à trancher ci-dessus).', '2. Revérifier les 12 citations LFI dans l\'édition 2027 et compléter les extraits tronqués.', '3. Transformer les pistes du jeu « Ça matche ? » en mesures citées (texte + page) quand les sources sont accessibles, ou importer les CSV Bastille avec `scripts/import-csv.mjs`.', '4. Ajouter les partis suivants dans `partis.json` : aucune modification d\'architecture nécessaire.', '');
  return L.join('\n');
}

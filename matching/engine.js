/* Bastille — moteur de matching v3 (propositions neutres).
   Pur, sans DOM : chargé tel quel dans index.html (injecté par matching/scripts/build.mjs) et dans les tests Node.
   Principes :
   - L'unité de calcul est la PROPOSITION. Une mesure non rattachée à une proposition validée reste sa propre
     proposition, soutenue par son seul auteur : c'est exactement le comportement du moteur v2.
   - SUPPORT  → compatibilité = poids de la réponse (contre 0, mitigé 50, d'accord 75, j'adore 100).
     OPPOSE   → compatibilité miroir (100 − poids).
     PARTIAL / DIFFERENT → aucun point (jamais 50 % par défaut) : la nuance est remontée, et la carte plus
                précise (proposition enfant) est proposée en priorité.
     UNKNOWN / absente → exclue du calcul : ni bonus ni malus.
   - Agrégation : propositions → famille → thème → moyenne des thèmes. Un sujet décliné en plusieurs cartes
     (même famille) ne pèse pas plus qu'un sujet à une carte. Chaque parti a un score indépendant, jamais normalisé.
   - Score ≠ confiance : la marge indicative, le nombre de propositions évaluées, la diversité des thèmes et
     la quantité de positions documentées sont rendus séparément. */
(function (root) {
  'use strict';
  var COMPAT = { contre: 0, neutre: 50, pour: 75, adore: 100 };
  var STANCES = ['SUPPORT', 'OPPOSE', 'PARTIAL', 'DIFFERENT', 'UNKNOWN'];
  var REL = { firstN: 15, firstThemes: 4, firstParties: 4, consN: 32, consThemes: 7, consParties: 7, consMin: 3, stable: 5, maxThemeShare: 0.5 };
  var MINEVAL = 2;      // moins de 2 propositions évaluées : parti classé après les autres
  var MIN_FOR_MARGIN = 3; // en dessous, pas de marge affichée : trop peu de données
  var SD_FLOOR = 15;    // écart-type plancher : évite une fausse précision quand toutes les réponses se ressemblent

  var scored = function (s) { return s === 'SUPPORT' || s === 'OPPOSE'; };
  var nuanced = function (s) { return s === 'PARTIAL' || s === 'DIFFERENT'; };
  var mean = function (v) { var t = 0; for (var i = 0; i < v.length; i++) t += v[i]; return t / v.length; };
  var keys = Object.keys;

  /* Modèle : { units:{id:{id,theme,famille,pos:{parti:position},rows:[],parent,children:[],common}}, rowUnit:{ligne:id}, excluded:Set }
     P : tableau des mesures du jeu ([thème, texte, auteur, n°, citation, exemple, famille?, autresPartis?]).
     compiled : propositions validées (matching/lib/compile.mjs). */
  function buildModel(P, compiled) {
    var units = {}, rowUnit = {}, excluded = {};
    var props = (compiled && compiled.propositions) || [];
    props.forEach(function (p) {
      units[p.id] = { id: p.id, theme: p.theme, famille: p.famille || p.id, pos: Object.assign({}, p.positions), rows: [], parent: p.parent || null, children: [], common: true };
      (p.mesuresApp || []).forEach(function (i) { excluded[i] = true; });
    });
    keys(units).forEach(function (id) { var u = units[id]; if (u.parent && units[u.parent]) units[u.parent].children.push(id); else u.parent = null; });
    P.forEach(function (row, i) {
      if (excluded[i]) return;
      var id = 'm' + i, pos = {};
      pos[row[2]] = 'SUPPORT';
      (row[7] || []).forEach(function (k) { pos[k] = 'SUPPORT'; });
      units[id] = { id: id, theme: row[0], famille: row[6] || id, pos: pos, rows: [i], parent: null, children: [], common: false };
      rowUnit[i] = id;
    });
    return { units: units, rowUnit: rowUnit, excluded: excluded };
  }

  // Rattache une ligne de carte (ajoutée au jeu) à une proposition validée.
  function attachRow(model, row, unitId) { model.units[unitId].rows.push(row); model.rowUnit[row] = unitId; }

  // Lignes jouables dans le deck principal, dans l'ordre croissant.
  function deckRows(model) { return keys(model.rowUnit).map(Number).sort(function (a, b) { return a - b; }); }

  // Réponses → réponses par proposition. Une proposition répondue deux fois ne compte qu'une fois (dernière réponse).
  function unitAnswers(model, answers) {
    var UA = {};
    (answers || []).forEach(function (x) { var u = model.rowUnit[x.i]; if (u) UA[u] = x.a; });
    return UA;
  }

  function partiesOf(model) {
    var s = {};
    keys(model.units).forEach(function (id) { var p = model.units[id].pos; keys(p).forEach(function (k) { if (scored(p[k])) s[k] = 1; }); });
    return keys(s);
  }

  function corpus(model, k) { var n = 0; keys(model.units).forEach(function (id) { if (scored(model.units[id].pos[k])) n++; }); return n; }

  function partyScore(model, UA, k) {
    var th = {}, ev = [], ok = 0, no = 0, fire = 0, neu = 0, unknown = 0, nuances = [], commonN = 0;
    keys(UA).forEach(function (id) {
      var a = UA[id], u = model.units[id];
      if (!u || !(a in COMPAT)) return;
      var s = u.pos[k];
      if (scored(s)) {
        var c = s === 'SUPPORT' ? COMPAT[a] : 100 - COMPAT[a];
        ev.push(c);
        th[u.theme] = th[u.theme] || {};
        (th[u.theme][u.famille] = th[u.theme][u.famille] || []).push(c);
        var yes = a === 'pour' || a === 'adore';
        if ((s === 'SUPPORT' && yes) || (s === 'OPPOSE' && a === 'contre')) ok++;
        if ((s === 'SUPPORT' && a === 'contre') || (s === 'OPPOSE' && yes)) no++;
        if (s === 'SUPPORT' && a === 'adore') fire++;
        if (a === 'neutre') neu++;
        if (u.common) commonN++;
      } else if (nuanced(s)) nuances.push({ unit: id, stance: s, answer: a, children: u.children.slice() });
      else unknown++;
    });
    var themes = keys(th);
    if (!themes.length) return null;
    var tm = {};
    themes.forEach(function (t) { tm[t] = mean(keys(th[t]).map(function (f) { return mean(th[t][f]); })); });
    var raw = mean(keys(tm).map(function (t) { return tm[t]; }));
    var n = ev.length, sd = 0;
    if (n > 1) { var m = mean(ev); sd = Math.sqrt(ev.reduce(function (acc, v) { return acc + (v - m) * (v - m); }, 0) / (n - 1)); }
    var margin = n >= MIN_FOR_MARGIN ? 1.96 * Math.max(sd, SD_FLOOR) / Math.sqrt(n) : null;
    var corp = corpus(model, k);
    return {
      k: k, raw: raw, pct: Math.round(raw), comp: n, ok: ok, no: no, fire: fire, neu: neu,
      themes: themes.length, th: tm, corpus: corp, cover: n / Math.max(1, corp),
      unknown: unknown, nuances: nuances, common: commonN,
      margin: margin == null ? null : Math.round(margin),
      interval: margin == null ? null : [Math.max(0, Math.round(raw - margin)), Math.min(100, Math.round(raw + margin))],
    };
  }

  function scores(model, UA) {
    var out = partiesOf(model).map(function (k) { return partyScore(model, UA, k); }).filter(Boolean)
      .sort(function (a, b) { return ((b.comp >= MINEVAL) - (a.comp >= MINEVAL)) || b.raw - a.raw || b.comp - a.comp || b.fire - a.fire; });
    // Égalité statistique avec le n°1 : marges qui se chevauchent (ou marge inconnue).
    var top = out[0];
    out.forEach(function (x, i) {
      x.tieWithTop = i > 0 && !!top && x.comp >= MINEVAL && (!x.interval || !top.interval || x.interval[1] >= top.interval[0]);
    });
    return out;
  }

  function reliability(model, UA, hist, opts) {
    var R = Object.assign({}, REL, opts || {});
    var ids = keys(UA).filter(function (id) { return (UA[id] in COMPAT) && model.units[id]; });
    var n = ids.length, byTheme = {}, documented = 0, common = 0, nuances = 0;
    ids.forEach(function (id) {
      var u = model.units[id]; byTheme[u.theme] = (byTheme[u.theme] || 0) + 1;
      var d = keys(u.pos).filter(function (k) { return scored(u.pos[k]); }).length;
      documented += d; if (d >= 2) common++;
      nuances += keys(u.pos).filter(function (k) { return nuanced(u.pos[k]); }).length;
    });
    var themes = keys(byTheme).length;
    var dom = keys(byTheme).sort(function (a, b) { return byTheme[b] - byTheme[a]; })[0] || null;
    var share = n ? (byTheme[dom] / n) : 0;
    var sc = scores(model, UA);
    var parties = sc.filter(function (x) { return x.comp >= R.consMin; }).length, partiesAny = sc.length;
    var h = hist || [], last = h.slice(-R.stable);
    var stable = last.length >= R.stable && last.every(function (x) { return x === last[0]; });
    var miss = [];
    var pl = function (n, s) { return n + ' ' + s + (n > 1 ? 's' : ''); };
    if (n < R.firstN) miss.push(pl(R.firstN - n, 'réponse') + ' de plus');
    if (themes < R.firstThemes) miss.push(pl(R.firstThemes - themes, 'thème') + ' de plus');
    if (partiesAny < R.firstParties) miss.push(pl(R.firstParties - partiesAny, 'parti') + ' de plus');
    if (n && share > R.maxThemeShare) miss.push('d\'autres thèmes');
    var lvl = 'explo';
    if (n >= R.firstN && themes >= R.firstThemes && partiesAny >= R.firstParties && share <= R.maxThemeShare) lvl = 'confirm';
    if (lvl === 'confirm' && n >= R.consN && themes >= R.consThemes && parties >= R.consParties && stable) lvl = 'consol';
    var ties = sc.filter(function (x) { return x.tieWithTop; }).map(function (x) { return x.k; });
    return {
      lvl: lvl, label: { explo: 'Exploratoire', confirm: 'À confirmer', consol: 'Consolidé' }[lvl],
      n: n, themes: themes, dominantTheme: dom, dominantShare: share, parties: parties, partiesAny: partiesAny,
      stable: stable, miss: miss, documented: documented, commonAnswered: common, nuances: nuances, tiesWithTop: ties,
    };
  }

  /* Sélection de la prochaine carte. Reprend la formule v2 (équilibre partis, thèmes, familles, mécanismes ;
     évite d'enchaîner des jumelles) et ajoute :
     - relance de précision : si une proposition répondue a des positions PARTIAL/DIFFERENT, sa carte enfant passe devant ;
     - départage : après le premier match, une carte sur deux peut servir à départager les partis à égalité statistique,
       uniquement si leurs positions documentées diffèrent. La couverture thématique reste prioritaire. */
  function pick(model, UA, order, rand, opts) {
    opts = opts || {};
    var R = Object.assign({}, REL, opts.rel || {});
    var mech = opts.mech || null, twins = opts.twins || [];
    var seen = {}; order.forEach(function (i) { seen[i] = 1; });
    var rem = deckRows(model).filter(function (i) { return !seen[i]; });
    if (!rem.length) return null;
    var unitOf = function (i) { return model.units[model.rowUnit[i]]; };
    var docOf = function (u) { return keys(u.pos).filter(function (k) { return scored(u.pos[k]); }); };
    var cp = {}, ct = {}, cf = {}, cm = {};
    order.forEach(function (i) {
      var u = unitOf(i); if (!u) return;
      docOf(u).forEach(function (k) { cp[k] = (cp[k] || 0) + 1; });
      ct[u.theme] = (ct[u.theme] || 0) + 1; cf[u.famille] = (cf[u.famille] || 0) + 1;
      var me = mech ? mech[i] : ''; cm[me] = (cm[me] || 0) + 1;
    });
    var evP = {}, evT = {}, nAns = 0;
    keys(UA).forEach(function (id) {
      var u = model.units[id]; if (!u || !(UA[id] in COMPAT)) return; nAns++;
      docOf(u).forEach(function (k) { evP[k] = (evP[k] || 0) + 1; });
      evT[u.theme] = (evT[u.theme] || 0) + 1;
    });
    var unlocked = nAns >= R.firstN;
    var recent = order.slice(-6);
    var tie = null;
    if (unlocked && order.length % 2 === 0) {
      var sc = scores(model, UA); if (sc[1] && sc[1].tieWithTop) tie = [sc[0].k, sc[1].k];
    }
    var avg = function (m, ks) { if (!ks.length) return 0; var t = 0; ks.forEach(function (k) { t += m[k] || 0; }); return t / ks.length; };
    var best = null, bs = Infinity;
    rem.forEach(function (i) {
      var u = unitOf(i), D = docOf(u);
      var s = avg(cp, D) * 3 + (ct[u.theme] || 0) * 2 + (cf[u.famille] || 0) * 4 + (cm[mech ? mech[i] : ''] || 0) * 0.5;
      if (unlocked) s += avg(evP, D) * 2 + (evT[u.theme] || 0) * 1.5;
      if (twins.some(function (t) { return (t[0] === i && recent.indexOf(t[1]) >= 0) || (t[1] === i && recent.indexOf(t[0]) >= 0); })) s += 6;
      if (u.parent && (u.parent in UA)) {
        var pp = model.units[u.parent].pos;
        if (keys(pp).some(function (k) { return nuanced(pp[k]); })) s -= 5;
      }
      if (tie && scored(u.pos[tie[0]]) && scored(u.pos[tie[1]]) && u.pos[tie[0]] !== u.pos[tie[1]]) s -= 3;
      s += rand() * 0.9;
      if (s < bs) { bs = s; best = i; }
    });
    return best;
  }

  // Nuances lisibles pour l'interface : « accord sur le principe, divergence sur les modalités ».
  function explainNuances(model, UA, k) {
    var r = partyScore(model, UA, k);
    return r ? r.nuances : [];
  }

  var api = {
    VERSION: '3.0.0', COMPAT: COMPAT, STANCES: STANCES, REL: REL, MINEVAL: MINEVAL, SD_FLOOR: SD_FLOOR, MIN_FOR_MARGIN: MIN_FOR_MARGIN,
    buildModel: buildModel, attachRow: attachRow, deckRows: deckRows, unitAnswers: unitAnswers,
    partyScore: partyScore, scores: scores, reliability: reliability, pick: pick, explainNuances: explainNuances,
  };
  root.BastilleMatching = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

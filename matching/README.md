# Bastille : matching par propositions neutres (v3)

« Swipe les idées, pas les candidats. » Un swipe porte sur une **proposition neutre**. Il compte pour **chaque parti** dont la position sur cette proposition est documentée.

## Schéma : trois niveaux

| Niveau | Fichier | Contenu |
|---|---|---|
| 1. Mesures originales | `data/mesures.json` | Texte original intact (`texte_original`, empreinte), parti, programme, référence/page, thème, sous-thème, URL, date, version, statut de vérification, origine. Les pistes du jeu « Ça matche ? » y figurent avec `texte_original: null`. |
| 2. Propositions neutres | `data/propositions.json` | `id`, `question`, `texte_carte` / `texte_simple` / `explication_simple`, thème, sous-thème, `famille`, `niveau_precision` (principe, modalité, paramètre, faible), `parent` (carte plus précise), `nuances`, `statut`. Plus `relations` (même objectif, modalités différentes). |
| Correspondances | `data/correspondances.json` | Mesure ↔ proposition : `equivalente`, `partielle` (avec le `fragment` couvert) ou `piste` (non validable). Champ `ambigu` et sa raison. |
| 3. Positions | `data/positions.json` | Une ligne par proposition et par parti : `SUPPORT`, `OPPOSE`, `PARTIAL`, `DIFFERENT`, `UNKNOWN`. Elle porte la justification, les mesures citées en preuve, les pistes, les écarts (seuils, montants, calendrier, conditions), la confiance et le type de preuve (`citation` ou `deduction`). |
| Décisions | `data/validations.json` | Décisions humaines (`valide`, `a_revoir`, `rejete`). **Seule porte d'entrée vers le calcul.** |
| Partis et sources | `data/partis.json`, `data/sources.json` | Ajouter un parti = une entrée dans `partis.json`. Le journal d'accès consigne les sources inaccessibles. |

## Règles de calcul (`engine.js`)

- SUPPORT : compatibilité = poids de la réponse (0 / 50 / 75 / 100). OPPOSE : compatibilité inversée. PARTIAL et DIFFERENT : rien n'est compté, ni 50 % ni autre valeur par défaut. La nuance est signalée et la carte enfant, plus précise, est proposée en priorité. UNKNOWN : exclue du calcul.
- Les scores remontent dans cet ordre : propositions, puis familles, puis thèmes, puis moyenne des thèmes. Chaque parti a son propre score, jamais normalisé. Publier plus de mesures ne rapporte pas plus de points.
- Une mesure non rattachée reste sa propre proposition, soutenue par son seul auteur. Sans validation, le résultat est **identique au moteur v2** (testé sur 600 sessions).
- Le score et la confiance sont distincts. Le moteur fournit une marge indicative (masquée sous 3 réponses), le nombre de propositions évaluées, les thèmes couverts, la part du thème dominant, les positions documentées et les égalités statistiques.
- Le premier match arrive à 15 réponses, si la couverture est suffisante : au moins 4 thèmes, 4 partis, et pas plus de la moitié des réponses sur un même thème.

## Commandes

```
npm run matching:import           # réimporte les mesures depuis index.html (détecte les textes modifiés)
npm run matching:import-csv -- f.csv   # importe un CSV Bastille (modèle : templates/mesures.csv)
npm run matching:build            # compile les validations, audite, régénère rapports, audit.html et index.html
npm test                          # tests unitaires et d'intégration (jsdom), puis vérification que le build est à jour
```

## Valider

1. Ouvrir `matching/audit.html` : chaque proposition, ses citations, les positions par parti, les alertes et ce qui entrerait dans le calcul.
2. Valider, mettre « à revoir » ou rejeter, puis exporter `validations.json`.
3. Remplacer `data/validations.json` par le fichier exporté, puis lancer `npm run matching:build`.

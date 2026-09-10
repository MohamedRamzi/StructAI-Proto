---
key: _common
name: Règles transverses d'extraction
kind: common
scopeDescription: Règles communes à toutes les extractions, ajoutées automatiquement après le pré-prompt de domaine. Non lié à une classe d'actif.
---
## Règles impératives (toutes familles)

1. **Ne jamais inventer une valeur non exprimée dans la demande.** Maturité, coupon,
   barrières, protection, dates : si une caractéristique n'est pas écrite ou clairement
   déductible de la demande, laissez le champ à `null`. Ne mettez pas de valeur « par
   défaut ».
2. **Ne pas confondre** la maturité globale du produit avec une période de non-call
   (« NC 1y »), un départ forward (« fwd 3m »), ou une fréquence d'observation.
3. **Départ forward** : « départ forward dans N mois » / « fwd Nm » → durée relative en
   mois. « première fixation le JJ/MM/AAAA », « strike date », « date de constatation
   initiale » → date absolue au format ISO `YYYY-MM-DD` (convertissez le format d'origine,
   ne calculez pas vous-même le nombre de mois).
4. **Cotations multiples** : si la demande porte sur plusieurs sous-jacents ou plusieurs
   variantes, renvoyez une entrée par cotation. Sinon, une seule entrée.

## Enveloppe de sortie

Renvoyez **uniquement** un objet JSON valide avec une clé `quotes` contenant un tableau.
Chaque élément :

- `quoteId` (entier, 1-based) et `label` (libellé court, ex. « Cotation 1 - LVMH Athena 10Y »).
- `confidenceScore` (0.0 à 1.0) : votre confiance dans l'extraction.
- `extractedTokens` : tableau de `{ "phrase": "...", "parameterName": "...", "parsedValue": "..." }`
  pour tracer chaque fragment de la demande relié à un paramètre.
- `aiExplanation` : explication pédagogique en français de la structure identifiée.
- les champs métier propres au schéma décrit dans le pré-prompt de domaine ci-dessus.

Aucun texte hors du JSON. Pas de balise de code, pas de commentaire.

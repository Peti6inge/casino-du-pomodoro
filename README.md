# Casino du Pomodoro

Minuteur pomodoro « casino » : les activités du jour sont tirées au sort sous contraintes de quotas et d’horaires.

Application **100 % front-end** (HTML, CSS, JavaScript), prévue pour **GitHub Pages** sans étape de build.

## Lancer en local

Ouvrez `index.html` dans le navigateur, ou servez le dossier avec un serveur statique simple :

```bash
python -m http.server 8080
```

Puis ouvrez `http://localhost:8080`.

> L’API **File System Access** (lier un fichier CSV sur le disque) nécessite un contexte sécurisé (HTTPS ou localhost) et un navigateur compatible (Chrome, Edge, Opera). Sinon, utilisez **Importer** / **Exporter** pour le fichier `casino-du-pomodoro.csv`.

## Persistance CSV

Un seul fichier regroupe :

| Type `type` | Rôle |
|-------------|------|
| `activity`  | Nom, objectif journalier (min), temps déjà fait aujourd’hui |
| `setting`   | Sessions min/max, pause déjeuner, fin de journée |
| `session`   | Historique des sessions du jour |
| `meta`      | Date du fichier (réinitialisation des compteurs au changement de jour) |

- **Mode recommandé** : bouton *Lier un fichier CSV* (écriture automatique après chaque modification).
- **Repli** : export téléchargé + import manuel.

## Règles métier (v1)

- Paramètres par défaut : session 15–40 min, déjeuner 12:30–13:30, fin de journée 17:00 (modifiables).
- Pas de démarrage de session pendant la pause déjeuner ni après l’heure de fin (affichage d’un message).
- **Tirage** : parmi les activités qui ont encore du quota, choix uniforme si le temps ouvrable restant jusqu’à la fin de journée (hors déjeuner) suffit pour tous les quotas restants ; sinon, seules les activités dont le quota individuel restant tient dans ce temps restent éligibles.
- Après validation d’une session, la durée est ajoutée au quota de l’activité et enregistrée dans le CSV, puis un **nouveau tirage** est proposé avec les mêmes règles.
- Les sessions en cours sont arrondies à la **minute entière** à la validation ; min/max appliqués sur cette durée (choix par défaut : pas de validation en dessous du min ni au-dessus du max).

## Structure

```
index.html   — interface
styles.css   — thème « casino »
app.js       — logique et CSV
```

## Déploiement GitHub Pages

Paramètres du dépôt → Pages → branche `main`, dossier racine (`/`).

## Licence

Usage personnel — projet de Romain (Peti6inge).
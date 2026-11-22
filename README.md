# Casino du Pomodoro

Un organiseur de journée ludique : la roue choisit une activité et une durée de session tout en protégeant les objectifs obligatoires.

L’application est entièrement front-end (HTML, CSS et JavaScript), sans dépendance ni étape de build. Elle peut être publiée telle quelle sur GitHub Pages.

## Lancer en local

```bash
python3 -m http.server 8080
```

Puis ouvrir [http://localhost:8080](http://localhost:8080).

Les notifications système nécessitent `localhost` ou HTTPS.

## Fonctionnement

### Activités obligatoires

- Chaque activité possède un objectif quotidien exact.
- La progression visible est plafonnée à 100 %, même si une session réelle dépasse le reliquat.
- Tant que tous les objectifs restent réalisables, la probabilité de tirer la catégorie obligatoire vaut :

  ```text
  temps obligatoire restant / temps ouvrable restant
  ```

- Dans cette catégorie, chaque activité est pondérée par son propre temps restant.
- Si tous les objectifs ne peuvent plus être terminés avant la fin de journée, la première activité obligatoire active et inachevée est imposée jusqu’à sa complétion.

### Activités facultatives

- Elles peuvent avoir un plafond quotidien, ou rester sans limite.
- Plus une activité a déjà reçu de temps aujourd’hui, plus sa probabilité diminue.
- Une même activité facultative ne peut pas être tirée deux fois de suite tant qu’une alternative est éligible.
- Un reliquat inférieur à la durée minimale peut être proposé tel quel.

### Durée et chrono

- Une durée prévisionnelle entière est tirée entre les limites configurées.
- Une session obligatoire ne peut pas laisser un reliquat non nul inférieur au minimum.
- La durée maximale doit être au moins égale à deux fois la durée minimale.
- Le chrono repose sur l’heure réelle et reprend après une actualisation.
- La clôture reste manuelle : la durée réelle arrondie à la minute est souveraine, même avant ou après l’échéance prévue.
- Une alerte interne, et si autorisé une notification système, est envoyée une minute avant la fin puis à l’échéance.

Le temps ouvrable est recalculé avec le timestamp courant à chaque tirage. La pause restante est déduite et aucun tirage ne démarre pendant la pause ou après la fin de journée.

## Persistance

Tout est enregistré automatiquement dans `localStorage` : paramètres, activités, ordre, réserves, historique et session active, après chaque modification.

Le changement de date remet implicitement les compteurs à zéro, car toutes les progressions sont calculées depuis les sessions du jour. La configuration et l’historique restent conservés.

## Tests

Le moteur métier est isolé dans `logic.js` et utilise uniquement des fonctions déterministes injectables.

```bash
node --test tests/logic.test.js
```

Les tests couvrent le temps ouvrable, les pondérations, le mode urgence, l’anti-répétition, les plafonds, les reliquats et la validation des paramètres.

## Structure

```text
index.html          interface Jeu et Paramètres
styles.css          thème responsive et animations
logic.js            moteur temporel et probabiliste
wheel.js            double roulette visuelle et sons
app.js              interface, chrono et stockage local
tests/logic.test.js tests unitaires sans dépendance
```

## Licence

Usage personnel — projet de Romain (Peti6inge).

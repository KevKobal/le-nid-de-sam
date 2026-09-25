# Le Nid de Sam — site de location

Site vitrine de la maison en location courte durée à Golbey (Vosges).

Site statique en HTML/CSS/JavaScript, sans dépendance ni étape de construction.

## Aperçu en ligne

Publié via GitHub Pages — voir le lien dans la description du dépôt.

## Contenu

| Fichier | Rôle |
|---|---|
| `index.html` | page principale : présentation de la maison, calendrier, demande de renseignements |
| `reservation.html` | page de réservation : choix des dates, coordonnées, options, récapitulatif |
| `style.css` | styles communs aux deux pages (couleurs et polices dans `:root`) |
| `calendrier.js` | prix des nuits, lecture de `dispos.json`, calendrier (commun aux deux pages) |
| `img/` | photos optimisées pour le web |
| `dispos.json` | nuits réservées, généré automatiquement (ne pas modifier à la main) |
| `scripts/maj_dispos.py` | lit l'agenda et produit `dispos.json` |
| `.github/workflows/dispos.yml` | lance ce script toutes les 10 minutes |

## Calendrier des disponibilités

### Noter une réservation (propriétaire)

Dans Google Agenda, sur téléphone ou ordinateur, créer un évènement **dans
l'agenda « Le Nid de Sam »** (et pas dans l'agenda personnel, qui est choisi
par défaut : vérifier la ligne de l'agenda avant d'enregistrer).

- **Toute la journée**, du **jour d'arrivée au jour de départ**. Exemple :
  arrivée le 3, départ le 6 → nuits du 3, 4 et 5 bloquées, le 6 reste libre
  pour une nouvelle arrivée.
- Ou avec des horaires (arrivée 15 h, départ 11 h) : même résultat.
- Le titre peut contenir le nom du client : **seules les dates** sont publiées.

Le site se met à jour en 10 à 20 minutes environ. Supprimer l'évènement libère les dates.

### Prix des nuits

Chaque nuit libre du calendrier affiche son prix (taxe de séjour comprise),
repris dans le récapitulatif de la page de réservation.

- **Prix de base** : 60 € en semaine, 75 € les nuits du vendredi et du samedi.
  Ils sont définis au début de `calendrier.js` (`TARIF_SEMAINE`,
  `TARIF_WEEKEND`), à modifier ici s'ils changent.
- **Prix d'une période particulière** (vacances, fêtes…), géré par le
  propriétaire depuis l'agenda « Le Nid de Sam » : créer un évènement
  **toute la journée** dont le titre commence par **« Tarif »** suivi du
  montant, par exemple « Tarif 95 », du premier soir concerné au lendemain du
  dernier (même règle qu'une réservation). Ce n'est **pas** une réservation :
  les nuits restent libres et affichent ce prix. Si deux périodes se
  chevauchent, la plus courte l'emporte.

### Fonctionnement

Toutes les 10 minutes, la tâche GitHub « Disponibilités » lit l'agenda par son
**adresse secrète au format iCal**, ne garde que les dates et écrit
`dispos.json`. La page lit ce fichier et affiche son propre calendrier.

- L'adresse secrète est stockée dans le secret **`ICAL_URLS`** du dépôt
  (Settings → Secrets and variables → Actions). Elle n'apparaît ni dans le
  code ni dans les journaux. Plusieurs adresses possibles, séparées par des
  espaces (par exemple Airbnb et Booking plus tard).
- L'agenda Google n'a **pas besoin d'être public**.
- Si un agenda est illisible, `dispos.json` n'est pas modifié (jamais de
  données partielles). La tâche apparaît alors en échec dans l'onglet Actions.
- Le site masque le calendrier si `dispos.json` n'existe pas ou date de plus
  de 7 jours, plutôt que d'afficher des dates périmées.
- Lancer une mise à jour immédiate : onglet **Actions** → « Disponibilités »
  → **Run workflow**.

### Brancher l'agenda (une seule fois, sur ordinateur)

1. Google Agenda → ⚙️ Paramètres → dans la colonne de gauche, l'agenda
   « Le Nid de Sam » → section « Intégrer l'agenda » → copier l'**adresse
   secrète au format iCal** (elle se termine par `basic.ics`).
2. GitHub → dépôt `le-nid-de-sam` → Settings → Secrets and variables →
   Actions → **New repository secret** → nom `ICAL_URLS`, valeur : l'adresse
   copiée.
3. Onglet Actions → « Disponibilités » → Run workflow.

Si l'adresse secrète a fuité : dans Google Agenda, « Réinitialiser » à côté de
l'adresse secrète, puis remplacer la valeur du secret `ICAL_URLS`.

## Demandes de réservation et de renseignements

- **Réservation** : bouton « Réserver » de la page principale →
  `reservation.html`. Le visiteur choisit ses dates dans le calendrier (ou les
  saisit), voit le prix, remplit ses coordonnées, coche les coffrets et
  accepte les conditions (horaires, annulation, règles). Le formulaire refuse
  un séjour qui contient une nuit déjà réservée.
- **Renseignements** : formulaire en bas de la page principale (nom, email,
  téléphone, question).
- **Téléphone** : 06 31 26 98 99, bouton d'appel sur l'accueil et dans
  l'en-tête de la page de réservation.

Les deux formulaires ouvrent la messagerie du visiteur avec un email
pré-rempli adressé au propriétaire : aucun serveur n'est nécessaire, et la
réservation n'est définitive qu'après sa confirmation. L'adresse est assemblée
par le script pour ne pas apparaître en clair dans le code source (anti-spam).

## À faire

- [ ] Reprendre les photos une fois la maison entièrement aménagée
- [ ] Retirer la balise `noindex` de `index.html` et `reservation.html` lors de la mise en ligne
      définitive (voir le commentaire dans le `<head>`)

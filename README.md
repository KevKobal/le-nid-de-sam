# Le Nid de Sam — site de location

Site vitrine de la maison en location courte durée à Golbey (Vosges).

Page unique en HTML/CSS/JavaScript, sans dépendance ni étape de construction :
le fichier `index.html` se suffit à lui-même.

## Aperçu en ligne

Publié via GitHub Pages — voir le lien dans la description du dépôt.

## Contenu

| Fichier | Rôle |
|---|---|
| `index.html` | tout le site : structure, styles et scripts |
| `img/` | photos optimisées pour le web |

## Modifier le calendrier des disponibilités

Le calendrier affiché sur le site est l'agenda Google « Le Nid de Sam ».
Les dates se bloquent directement depuis l'application Google Agenda, sans
toucher au site.

L'agenda utilisé est défini par une seule ligne au début du `<script>`, à la fin
de `index.html` :

```js
const AGENDA_ID = '...@group.calendar.google.com';
```

Si cette ligne est vide, la section « Disponibilités » et son lien de menu
disparaissent automatiquement du site.

Deux points de vigilance :

- l'agenda doit être **public** (réglage à faire depuis un ordinateur,
  impossible depuis l'application mobile) ;
- les évènements doivent s'intituler uniquement « **Réservé** » : tout ce qui
  est écrit dans le titre est potentiellement visible publiquement.

## Demandes de réservation

Le formulaire ouvre la messagerie du visiteur avec un email pré-rempli adressé
au propriétaire. Aucun serveur n'est nécessaire. L'adresse est assemblée par le
script pour ne pas apparaître en clair dans le code source (anti-spam).

## À faire

- [ ] Reprendre les photos une fois la maison entièrement aménagée
- [ ] Confirmer les tarifs et les horaires d'arrivée / départ
- [ ] Retirer la balise `noindex` de `index.html` lors de la mise en ligne
      définitive (voir le commentaire dans le `<head>`)

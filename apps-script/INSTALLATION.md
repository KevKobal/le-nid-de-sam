# Réservation avec paiement en ligne — installation

Ce dossier contient le petit programme (Google Apps Script) qui permet au site
d'encaisser les réservations : le client choisit ses dates, paie sur Stripe,
et la réservation est **inscrite automatiquement dans l'agenda** « Le Nid de
Sam » dès que le paiement passe. Le client reçoit un email de confirmation,
le propriétaire un avis, et le planning du site se met à jour dans la minute.

Tant que l'installation n'est pas terminée, le site fonctionne comme avant
(demande par email, sans paiement en ligne).

À faire **sur un ordinateur**, connecté au compte Google **qui possède
l'agenda** « Le Nid de Sam » (leniddesam@gmail.com). Compter 20 minutes.

---

## 1. Repasser l'agenda en privé

Les réservations inscrites par le programme contiennent le nom, l'email et le
téléphone du client : l'agenda ne doit plus être public. Le programme refuse
de s'installer tant qu'il l'est.

Google Agenda → ⚙️ **Paramètres** → dans la colonne de gauche, **Le Nid de
Sam** → **Autorisations d'accès aux événements** → **décocher** « Rendre
disponible publiquement ».

(Le site n'a plus besoin que l'agenda soit public : il le lit par son adresse
secrète, ou par ce programme.)

## 2. Créer le compte Stripe et copier la clé d'essai

1. Créer un compte sur **stripe.com** (au nom du propriétaire).
2. Rester en **mode test** (interrupteur « Mode test » activé) : aucun vrai
   paiement n'est possible dans ce mode, c'est fait pour essayer.
3. **Développeurs** → **Clés API** → ligne **Clé secrète** (elle commence
   par `sk_test_`) → **Révéler** → copier.

⚠️ Cette clé donne accès au compte Stripe : ne l'envoyer à personne, ni par
email ni par message. Elle ne sera collée qu'à un seul endroit, à l'étape 3.

Facultatif : **Paramètres** → **Moyens de paiement** → activer **PayPal** (et
vérifier que Apple Pay / Google Pay sont actifs) pour les proposer au client
sur la page de paiement.

## 3. Créer le programme dans Google

1. Aller sur **script.google.com** → **Nouveau projet**. Le renommer (en haut
   à gauche) : `Le Nid de Sam – Réservations`.
2. ⚙️ **Paramètres du projet** → cocher **Afficher le fichier manifeste
   « appsscript.json » dans l'éditeur**.
3. Retour à l'éditeur (icône `< >`) :
   - fichier **Code.gs** : tout effacer, puis coller le contenu de
     [`Code.gs`](https://raw.githubusercontent.com/KevKobal/le-nid-de-sam/main/apps-script/Code.gs) ;
   - fichier **appsscript.json** : tout effacer, puis coller le contenu de
     [`appsscript.json`](https://raw.githubusercontent.com/KevKobal/le-nid-de-sam/main/apps-script/appsscript.json) ;
   - enregistrer (icône disquette).
4. ⚙️ **Paramètres du projet** → **Propriétés du script** → **Ajouter une
   propriété du script**, deux fois :

   | Propriété | Valeur |
   |---|---|
   | `STRIPE_SECRET_KEY` | la clé `sk_test_…` copiée à l'étape 2 |
   | `ADRESSE` | l'adresse complète de la maison (elle est envoyée au client **après** paiement, et n'apparaît jamais sur le site) |

   Facultatif : `EMAIL_PROPRIETAIRE` si les avis de réservation doivent
   partir vers une autre adresse que ce compte Google.
5. Retour à l'éditeur → en haut, choisir la fonction **`installer`** →
   **Exécuter**.
   - Google demande des autorisations (agenda, envoi d'emails, connexion à
     Stripe, tâche automatique). Choisir le compte, puis, sur l'écran « Google
     n'a pas validé cette application » : **Paramètres avancés** → **Accéder
     à Le Nid de Sam – Réservations** → **Autoriser**. C'est normal pour un
     programme personnel que Google n'a pas publié.
   - En bas, le journal doit afficher : `Installation terminée. Mode Stripe :
     essai (test).` Sinon, il indique ce qui manque (clé, adresse, agenda
     encore public…).

## 4. Mettre le programme en ligne

1. **Déployer** → **Nouveau déploiement** → icône ⚙️ à côté de « Type » →
   **Application Web**.
2. Description : `Réservations` ; **Exécuter en tant que** : **Moi** ;
   **Qui a accès** : **Tout le monde**.
3. **Déployer** → copier l'**URL de l'application Web** (elle se termine par
   `/exec`).

Cette adresse n'est pas secrète (le site l'utilisera publiquement) : on peut
la transmettre pour qu'elle soit renseignée dans `calendrier.js`
(`const API_RESERVATION = '…/exec';`).

## 5. Essayer (mode test)

Sur la page de réservation, réserver des dates en payant avec la carte de
test Stripe :

- numéro `4242 4242 4242 4242`, date d'expiration future, code `123`.

Vérifier : la réservation « Réservé – … » apparaît en vert dans l'agenda,
les emails sont reçus (client et propriétaire), le planning du site affiche
les nuits réservées. Supprimer ensuite l'évènement d'essai dans l'agenda.

## 6. Passer aux vrais paiements

Seulement quand tout est prêt :

1. **Mentions légales et conditions générales de vente** publiées sur le
   site (page `cgv.html`, liée depuis la page de réservation), relues par un
   professionnel.
2. Compte Stripe **activé** (Stripe demande notamment une pièce d'identité et
   un RIB).
3. Dans Stripe, mode test **désactivé** → Développeurs → Clés API → copier la
   clé secrète **`sk_live_…`**.
4. Dans le programme : Propriétés du script → remplacer la valeur de
   `STRIPE_SECRET_KEY` par la clé `sk_live_…` → relancer **`installer`**. Le
   journal doit afficher `Mode Stripe : PAIEMENTS RÉELS`.

---

## Au quotidien (propriétaire)

- **« Réservé – Nom »** (en vert) : réservation payée en ligne. Tous les
  détails sont dans la description de l'évènement. Ne pas modifier les lignes
  sous « Informations techniques ».
- **« En attente de paiement – Nom »** (en gris) : un client est en train de
  payer. Ses dates sont retenues 30 minutes au plus, puis libérées
  automatiquement s'il ne paie pas.
- **Réservations prises par téléphone** : les noter dans l'agenda comme
  avant (journée entière, du jour d'arrivée au jour de départ).
- **Prix d'une période** : évènement « Tarif 95 » comme avant.
- **Annulation / remboursement** : rembourser depuis Stripe (Paiements →
  choisir le paiement → Rembourser), puis supprimer l'évènement de l'agenda.
  Rappel : une annulation moins de 48 h avant l'arrivée n'est pas remboursée.

## Mettre à jour le programme

Après une modification de `Code.gs` : recoller le fichier dans l'éditeur,
puis **Déployer** → **Gérer les déploiements** → ✏️ → Version : **Nouvelle
version** → **Déployer**. L'adresse `/exec` ne change pas.

## Bon à savoir

- Si le programme ne répond pas, le planning du site retombe sur
  `dispos.json` (tâche GitHub toutes les 10 minutes), et la page de
  réservation affiche un message d'erreur avec le numéro de téléphone.
- Un compte Gmail gratuit peut envoyer environ 100 emails par jour : large
  pour un gîte (2 emails par réservation).
- Les données des clients (nom, email, téléphone) restent dans l'agenda
  privé et dans Stripe ; elles ne sont jamais publiées sur le site. Les
  mentionner dans la politique de confidentialité (avec les mentions légales).

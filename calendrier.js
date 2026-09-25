/* Le Nid de Sam — prix des nuits, disponibilités et calendrier.

   Chargé par les deux pages :
   - index.html : calendrier en lecture seule (section « Disponibilités ») ;
   - reservation.html : calendrier où le visiteur choisit ses dates
     (attribut data-choix sur l'élément .cal).

   Les nuits réservées et les tarifs particuliers sont lus dans dispos.json,
   que la tâche GitHub « Disponibilités » met à jour toutes les 10 minutes à
   partir de l'agenda Google « Le Nid de Sam » (voir le README). En ligne,
   le fichier est lu directement sur GitHub (à jour à 5 min près, sans
   attendre la republication du site) ; en local, à côté de la page. */

/* ═══════════════════════════════════════════════════════════════════
   PRIX DES NUITS — à modifier ici si les tarifs de base changent

   Taxe de séjour comprise. Le week-end = les nuits du vendredi et du
   samedi. Pour une période particulière (vacances, fêtes…), le
   propriétaire crée dans l'agenda un évènement « Tarif 95 » : il
   remplace ces prix sur les nuits concernées (voir le README).
   ═══════════════════════════════════════════════════════════════════ */
const TARIF_SEMAINE = 60;
const TARIF_WEEKEND = 75;

// Dates manipulées en heure locale, au format AAAA-MM-JJ
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const depuisIso = (s) => { const [a, m, j] = s.split('-').map(Number); return new Date(a, m - 1, j); };
const lendemain = (s) => { const d = depuisIso(s); d.setDate(d.getDate() + 1); return iso(d); };
const jourMois = (s) => depuisIso(s).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
const euros = (n) => `${n.toLocaleString('fr-FR')} €`;

// Nuits réservées et tarifs particuliers, remplis depuis dispos.json
const dispos = { reserve: new Set(), tarifs: new Map() };
const prixNuit = (d) => dispos.tarifs.get(iso(d)) ??
  (d.getDay() === 5 || d.getDay() === 6 ? TARIF_WEEKEND : TARIF_SEMAINE);

// Estimation d'un séjour (dates au format AAAA-MM-JJ, départ exclu) :
// nombre de nuits, prix total, et nuits déjà réservées dans l'intervalle.
const estimerSejour = (arrivee, depart) => {
  if (!arrivee || !depart) return null;
  const debut = depuisIso(arrivee), fin = depuisIso(depart);
  if (fin <= debut) return { erreur: 'La date de départ doit être après la date d’arrivée.' };
  let nuits = 0, prix = 0; const prises = [];
  for (let d = new Date(debut); d < fin; d.setDate(d.getDate() + 1)) {
    nuits++; prix += prixNuit(d);
    if (dispos.reserve.has(iso(d))) prises.push(iso(d));
  }
  return { nuits, prix, prises };
};

// « la nuit du 10 octobre » / « les nuits du 10 octobre et du 11 octobre »
const phraseNuitsPrises = (prises) => {
  const jours = prises.map(jourMois);
  const liste = jours.length > 1 ? `${jours.slice(0, -1).join(', du ')} et du ${jours.at(-1)}` : jours[0];
  return `${jours.length > 1 ? 'les nuits' : 'la nuit'} du ${liste} ${jours.length > 1 ? 'sont déjà réservées' : 'est déjà réservée'}`;
};

/* ═══════════════════════════════════════════════════════════════════
   CALENDRIER DES DISPONIBILITÉS — rien à modifier ici
   ═══════════════════════════════════════════════════════════════════ */
const Calendrier = (() => {
  const SOURCE = location.hostname.endsWith('github.io')
    ? 'https://raw.githubusercontent.com/KevKobal/le-nid-de-sam/main/dispos.json'
    : 'dispos.json';
  const MOIS_MAX = 17;          // on peut feuilleter jusqu'à 17 mois après le mois en cours
  const PERIME_JOURS = 7;       // au-delà, les données sont jugées trop anciennes pour être affichées

  const bloc = document.querySelector('.cal');
  const zone = document.getElementById('cal-mois');
  const prec = document.getElementById('cal-prev');
  const suiv = document.getElementById('cal-next');
  const choix = bloc?.hasAttribute('data-choix');   // page de réservation : dates cliquables

  const aujourdhui = new Date(); aujourdhui.setHours(0, 0, 0, 0);
  const cleAujourdhui = iso(aujourdhui);
  const nomMois = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
  const JOURS = [['L', 'lundi'], ['M', 'mardi'], ['M', 'mercredi'], ['J', 'jeudi'], ['V', 'vendredi'], ['S', 'samedi'], ['D', 'dimanche']];

  let decalage = 0;             // nombre de mois après le mois en cours
  let arrivee = null, depart = null;
  const abonnes = [];           // fonctions appelées quand le visiteur choisit des dates

  const tableMois = (annee, mois) => {
    const table = document.createElement('table');
    table.className = 'mois';
    const premier = new Date(annee, mois, 1);
    let html = `<caption>${nomMois.format(premier)}</caption><thead><tr>` +
      JOURS.map(([c, l]) => `<th scope="col"><abbr title="${l}">${c}</abbr></th>`).join('') + '</tr></thead><tbody><tr>';
    const vides = (premier.getDay() + 6) % 7;   // la semaine commence le lundi
    html += '<td></td>'.repeat(vides);
    const nbJours = new Date(annee, mois + 1, 0).getDate();
    for (let j = 1; j <= nbJours; j++) {
      const jour = new Date(annee, mois, j);
      const cle = iso(jour);
      const passe = jour < aujourdhui;
      const pris = !passe && dispos.reserve.has(cle);
      const classes = ['case', passe ? 'passe' : pris ? 'pris' : 'libre'];
      if (cle === cleAujourdhui) classes.push('aujourdhui');
      if (arrivee && cle === arrivee) classes.push('debut');
      if (depart && cle === depart) classes.push('fin');
      if (arrivee && depart && cle > arrivee && cle < depart) classes.push('entre');
      // Texte lu par les lecteurs d'écran seulement : l'état ne passe pas que par la couleur
      const etat = pris ? '<span class="vh"> : nuit réservée</span>' : '';
      const prix = !passe && !pris ? `<span class="prix">${prixNuit(jour)}&nbsp;€</span>` : '';
      const contenu = `<span class="num">${j}</span>${etat}${prix}`;
      html += choix && !passe
        ? `<td><button type="button" class="${classes.join(' ')}" data-date="${cle}">${contenu}</button></td>`
        : `<td><span class="${classes.join(' ')}">${contenu}</span></td>`;
      if ((vides + j) % 7 === 0 && j < nbJours) html += '</tr><tr>';
    }
    html += '<td></td>'.repeat((7 - (vides + nbJours) % 7) % 7) + '</tr></tbody>';
    table.innerHTML = html;
    return table;
  };

  const afficher = () => {
    if (!zone) return;
    const base = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth() + decalage, 1);
    const suivant = new Date(base.getFullYear(), base.getMonth() + 1, 1);
    zone.replaceChildren(tableMois(base.getFullYear(), base.getMonth()), tableMois(suivant.getFullYear(), suivant.getMonth()));
    prec.disabled = decalage === 0;
    suiv.disabled = decalage >= MOIS_MAX;
  };

  // Choix des dates au clic : 1er clic = arrivée, 2e clic = départ.
  // Le départ peut tomber sur une nuit réservée (quelqu'un arrive le soir
  // même), mais aucune nuit du séjour ne doit l'être.
  const message = document.getElementById('cal-choix');
  const dire = (texte) => { if (message) message.textContent = texte; };
  const cliquer = (cle) => {
    if (!arrivee || depart || cle <= arrivee) {
      if (dispos.reserve.has(cle)) { dire(`La nuit du ${jourMois(cle)} est déjà réservée : choisissez une autre date d’arrivée.`); return; }
      arrivee = cle; depart = null;
      dire(`Arrivée le ${jourMois(cle)}. Choisissez maintenant votre date de départ.`);
    } else {
      const e = estimerSejour(arrivee, cle);
      if (e.prises.length) { dire(`Impossible : ${phraseNuitsPrises(e.prises)}. Choisissez un départ plus tôt.`); return; }
      depart = cle;
      dire(`Du ${jourMois(arrivee)} au ${jourMois(depart)} : ${e.nuits} nuit${e.nuits > 1 ? 's' : ''}, ${euros(e.prix)}.`);
    }
    afficher();
    abonnes.forEach(f => f(arrivee, depart));
  };

  if (zone) {
    prec.addEventListener('click', () => { decalage = Math.max(0, decalage - 1); afficher(); });
    suiv.addEventListener('click', () => { decalage = Math.min(MOIS_MAX, decalage + 1); afficher(); });
    if (choix) zone.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-date]');
      if (b) cliquer(b.dataset.date);
    });
  }

  fetch(SOURCE, { cache: 'no-cache' })
    .then(r => r.ok ? r.json() : Promise.reject(new Error('dispos.json absent')))
    .then(donnees => {
      const maj = depuisIso(donnees.maj);
      if ((aujourdhui - maj) / 864e5 > PERIME_JOURS) return;   // données trop anciennes : on n'affiche rien
      for (const [debut, fin] of donnees.reserve || []) {
        for (let d = depuisIso(debut); d < depuisIso(fin); d.setDate(d.getDate() + 1)) dispos.reserve.add(iso(d));
      }
      for (const [debut, fin, prix] of donnees.tarifs || []) {
        for (let d = depuisIso(debut); d < depuisIso(fin); d.setDate(d.getDate() + 1)) dispos.tarifs.set(iso(d), prix);
      }
      const texteMaj = document.getElementById('cal-maj');
      if (texteMaj) texteMaj.textContent =
        `Mis à jour le ${maj.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}. Les disponibilités restent à confirmer lors de votre demande.`;
      afficher();
      // Éléments masqués tant que les disponibilités ne sont pas connues
      document.querySelectorAll('[data-si-dispos]').forEach(el => { el.hidden = false; });
      document.dispatchEvent(new Event('dispos-chargees'));   // les formulaires recalculent leur estimation
    })
    .catch(() => { /* pas de données : le calendrier reste masqué */ });

  return {
    // Appelé quand le visiteur choisit ses dates dans le calendrier
    auChoix: (f) => abonnes.push(f),
    // Aligne le calendrier sur des dates saisies dans le formulaire
    definir: (a, d) => {
      arrivee = a || null; depart = a && d && d > a ? d : null;
      if (arrivee) {
        const m = depuisIso(arrivee);
        decalage = Math.min(MOIS_MAX, Math.max(0, (m.getFullYear() - aujourdhui.getFullYear()) * 12 + m.getMonth() - aujourdhui.getMonth()));
      }
      afficher();
    },
  };
})();

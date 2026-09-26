/**
 * Le Nid de Sam — réservation avec paiement en ligne (Stripe).
 *
 * Programme Google Apps Script, installé dans le compte Google qui possède
 * l'agenda « Le Nid de Sam » (voir apps-script/INSTALLATION.md). Il sert de
 * petit serveur au site, qui est statique :
 *
 *  - GET  ?action=dispos           → nuits réservées et tarifs, lus en direct
 *                                     dans l'agenda (planning du site) ;
 *  - POST {action: "reserver", …}   → vérifie les dates, calcule le prix,
 *                                     met les dates de côté et renvoie
 *                                     l'adresse de la page de paiement Stripe ;
 *  - GET  ?action=confirmer&session_id=…  → appelé par la page merci.html :
 *                                     si le paiement est passé, la réservation
 *                                     devient définitive ;
 *  - GET  ?action=liberer&jeton=…   → paiement abandonné : dates libérées.
 *
 * Toutes les 5 minutes, verifierPaiements() rattrape les paiements dont la
 * page de retour n'a pas été affichée, et libère les dates mises de côté
 * dont le paiement n'a pas abouti.
 *
 * Aucune donnée secrète dans ce fichier (il est publié sur GitHub). Réglages
 * dans Paramètres du projet → Propriétés du script :
 *   STRIPE_SECRET_KEY   clé secrète Stripe (sk_test_… pour les essais, sk_live_… ensuite)
 *   ADRESSE             adresse complète de la maison, envoyée au client après paiement
 *   EMAIL_PROPRIETAIRE  (facultatif) destinataire des avis ; par défaut, ce compte Google
 */

const CONFIG = {
  AGENDA_ID: '6f457dc5e291303a514794c7bf1a1250cdabaddd1aca3b127147487893eaa8b6@group.calendar.google.com',
  SITE: 'https://kevkobal.github.io/le-nid-de-sam/',
  FUSEAU: 'Europe/Paris',
  // Prix : les mêmes que dans calendrier.js (site). Taxe de séjour comprise.
  TARIF_SEMAINE: 60,
  TARIF_WEEKEND: 75,            // nuits du vendredi et du samedi
  COFFRETS: {
    love: { nom: 'Pack LOVE', prix: 49 },
    vosgien: { nom: 'Coffret Vosgien', prix: 29 },
  },
  VOYAGEURS_MAX: 2,
  NUITS_MAX: 28,
  HORIZON_JOURS: 550,           // réservation possible jusqu'à ~18 mois à l'avance
  ATTENTE_MINUTES: 30,          // dates mises de côté pendant le paiement (minimum imposé par Stripe)
  DEMANDES_MAX_JOUR: 30,        // protection contre les robots
  DEMANDES_MAX_EMAIL_JOUR: 5,
  HEURE_ARRIVEE: '16:00',
  HEURE_DEPART: '11:00',
  HEURES_PREVUES: ['', 'Entre 16 h et 17 h', 'Entre 17 h et 18 h', 'Entre 18 h et 19 h', 'Entre 19 h et 20 h', 'Après 20 h'],
};
const PREFIXE_ATTENTE = 'En attente de paiement';
const PREFIXE_RESERVE = 'Réservé';
const MARQUE_SITE = 'le-nid-de-sam';
const MARQUE_EMAILS = 'emails: envoyés';

/* ═══════════════════════════ Points d'entrée ═══════════════════════════ */

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.action === 'dispos') return json(disposPubliques());
    if (p.action === 'confirmer') return json(finaliser(String(p.session_id || '')));
    if (p.action === 'liberer') return json(liberer(String(p.jeton || '')));
    return json({ ok: true, service: 'Le Nid de Sam' });
  } catch (err) {
    console.error(err);
    return json({ ok: false, erreur: 'serveur', message: 'Une erreur est survenue. Merci de réessayer ou d’appeler le 06 31 26 98 99.' });
  }
}

function doPost(e) {
  try {
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (d.action === 'reserver') return json(reserver(d));
    return json({ ok: false, erreur: 'action' });
  } catch (err) {
    console.error(err);
    return json({ ok: false, erreur: 'serveur', message: 'Une erreur est survenue. Merci de réessayer ou d’appeler le 06 31 26 98 99.' });
  }
}

function json(objet) {
  return ContentService.createTextOutput(JSON.stringify(objet)).setMimeType(ContentService.MimeType.JSON);
}

/* ═══════════════════════════ Dates (format AAAA-MM-JJ) ═══════════════════════════ */

const RE_ISO = /^\d{4}-\d{2}-\d{2}$/;
function ajouterJours(iso, n) {
  const [a, m, j] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j + n));
  return d.toISOString().slice(0, 10);
}
function ecartJours(isoA, isoB) {
  const t = (s) => { const [a, m, j] = s.split('-').map(Number); return Date.UTC(a, m - 1, j); };
  return Math.round((t(isoB) - t(isoA)) / 864e5);
}
function jourSemaine(iso) {            // 0 = dimanche … 6 = samedi
  const [a, m, j] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, j)).getUTCDay();
}
function isoParis(date) { return Utilities.formatDate(date, CONFIG.FUSEAU, 'yyyy-MM-dd'); }
function dateParis(iso, heure) { return Utilities.parseDate(iso + ' ' + (heure || '00:00'), CONFIG.FUSEAU, 'yyyy-MM-dd HH:mm'); }
function aujourdhui() { return isoParis(new Date()); }
function dateLongue(iso) {
  const mois = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const jours = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const [a, m, j] = iso.split('-').map(Number);
  return `${jours[jourSemaine(iso)]} ${j} ${mois[m - 1]} ${a}`;
}

/* ═══════════════════════════ Lecture de l'agenda ═══════════════════════════ */

function agenda() {
  const cal = CalendarApp.getCalendarById(CONFIG.AGENDA_ID);
  if (!cal) throw new Error('Agenda « Le Nid de Sam » introuvable pour ce compte Google.');
  return cal;
}

const RE_TARIF = /^\s*tarif\b\D*(\d+)/i;
const estTarif = (titre) => /^\s*tarif\b/i.test(titre);

/**
 * Nuits couvertes par un évènement (une nuit = la date du soir).
 * Mêmes règles que scripts/maj_dispos.py :
 *  - journée entière saisie dans Google Agenda, du jour d'arrivée au jour de
 *    départ : Google stocke la fin au lendemain du départ, on retire ce jour ;
 *  - évènement avec horaires : du soir de la date de début à la date de fin exclue ;
 *  - évènement d'une seule journée : bloque ce soir-là.
 */
function nuitsEvenement(ev) {
  let debut, fin;
  if (ev.isAllDayEvent()) {
    debut = isoParis(ev.getAllDayStartDate());
    fin = isoParis(ev.getAllDayEndDate());
    if (ecartJours(debut, fin) >= 2) fin = ajouterJours(fin, -1);
  } else {
    debut = isoParis(ev.getStartTime());
    fin = isoParis(ev.getEndTime());
  }
  if (fin <= debut) fin = ajouterJours(debut, 1);
  const nuits = [];
  for (let n = debut; n < fin; n = ajouterJours(n, 1)) nuits.push(n);
  return nuits;
}

/** Lit l'agenda entre deux dates : nuits réservées (Set) et prix particuliers (Map). */
function lireAgenda(debutIso, finIso) {
  const evs = agenda().getEvents(dateParis(ajouterJours(debutIso, -1)), dateParis(ajouterJours(finIso, 1)));
  const reserve = new Set();
  const periodes = [];
  evs.forEach(ev => {
    const titre = ev.getTitle() || '';
    const nuits = nuitsEvenement(ev);
    if (estTarif(titre)) {
      const m = titre.match(RE_TARIF);
      if (m) periodes.push({ duree: nuits.length, prix: Number(m[1]), nuits });
    } else {
      nuits.forEach(n => reserve.add(n));
    }
  });
  // Période la plus courte prioritaire (ex. un week-end posé dans une saison)
  const tarifs = new Map();
  periodes.sort((a, b) => b.duree - a.duree).forEach(p => p.nuits.forEach(n => tarifs.set(n, p.prix)));
  return { reserve, tarifs };
}

function prixNuit(iso, tarifs) {
  if (tarifs.has(iso)) return tarifs.get(iso);
  const j = jourSemaine(iso);
  return j === 5 || j === 6 ? CONFIG.TARIF_WEEKEND : CONFIG.TARIF_SEMAINE;
}

/** Plages consécutives : ["…-03","…-04","…-05"] → [["…-03","…-06"]] (1re nuit, jour de départ). */
function enPlages(nuits, prixDe) {
  const plages = [];
  nuits.slice().sort().forEach(n => {
    const der = plages[plages.length - 1];
    const p = prixDe ? prixDe(n) : null;
    if (der && der[1] === n && (!prixDe || der[2] === p)) der[1] = ajouterJours(n, 1);
    else plages.push(prixDe ? [n, ajouterJours(n, 1), p] : [n, ajouterJours(n, 1)]);
  });
  return plages;
}

/** Planning public : uniquement des dates et des prix, jamais de nom. Mis en cache 60 s. */
function disposPubliques() {
  const cache = CacheService.getScriptCache();
  const enCache = cache.get('dispos');
  if (enCache) return JSON.parse(enCache);
  const debut = aujourdhui();
  const fin = ajouterJours(debut, CONFIG.HORIZON_JOURS);
  const { reserve, tarifs } = lireAgenda(debut, fin);
  const dansHorizon = (n) => n >= debut && n < fin;
  const donnees = {
    maj: debut,
    reserve: enPlages([...reserve].filter(dansHorizon)),
    tarifs: enPlages([...tarifs.keys()].filter(dansHorizon), (n) => tarifs.get(n)),
  };
  cache.put('dispos', JSON.stringify(donnees), 60);
  return donnees;
}

/* ═══════════════════════════ Réservation ═══════════════════════════ */

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RE_TEL = /^[+0-9 ().-]{6,25}$/;
const texte = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

/** Contrôle et nettoie les champs envoyés par le site. Renvoie { erreur } ou { donnees }. */
function valider(d) {
  if (d.site_web) return { erreur: 'robot' };            // champ piège invisible pour un humain
  const v = {
    arrivee: String(d.arrivee || ''), depart: String(d.depart || ''),
    prenom: texte(d.prenom, 60), nom: texte(d.nom, 60),
    email: texte(d.email, 120).toLowerCase(), tel: texte(d.tel, 25),
    voyageurs: Number(d.voyageurs),
    heure: CONFIG.HEURES_PREVUES.indexOf(d.heure) >= 0 ? d.heure : '',
    coffrets: (Array.isArray(d.coffrets) ? d.coffrets : []).filter(c => CONFIG.COFFRETS[c]),
    message: String(d.message || '').trim().slice(0, 1000),
  };
  const manque = [];
  if (!v.prenom) manque.push('prénom');
  if (!v.nom) manque.push('nom');
  if (!RE_EMAIL.test(v.email)) manque.push('email');
  if (!RE_TEL.test(v.tel)) manque.push('téléphone');
  if (!(v.voyageurs >= 1 && v.voyageurs <= CONFIG.VOYAGEURS_MAX)) manque.push('nombre de voyageurs');
  if (d.conditions !== true) manque.push('conditions du séjour');
  if (d.cgv !== true) manque.push('conditions générales de vente');
  if (!RE_ISO.test(v.arrivee) || !RE_ISO.test(v.depart)) manque.push('dates');
  if (manque.length) return { erreur: 'champs', message: 'À compléter : ' + manque.join(', ') + '.' };

  const auj = aujourdhui();
  const nuits = ecartJours(v.arrivee, v.depart);
  if (v.arrivee < auj) return { erreur: 'dates', message: 'La date d’arrivée est passée.' };
  if (nuits < 1) return { erreur: 'dates', message: 'La date de départ doit être après la date d’arrivée.' };
  if (nuits > CONFIG.NUITS_MAX) return { erreur: 'dates', message: `Pour un séjour de plus de ${CONFIG.NUITS_MAX} nuits, merci de nous appeler au 06 31 26 98 99.` };
  if (ecartJours(auj, v.arrivee) > CONFIG.HORIZON_JOURS) return { erreur: 'dates', message: 'Ces dates ne sont pas encore ouvertes à la réservation.' };
  v.nuits = nuits;
  return { donnees: v };
}

/** Limite le nombre de demandes (par jour, et par adresse email). */
function limiteAtteinte(email) {
  const cache = CacheService.getScriptCache();
  const cles = ['demandes-' + aujourdhui(), 'email-' + aujourdhui() + '-' + email];
  const [total, parEmail] = cles.map(c => Number(cache.get(c) || 0));
  if (total >= CONFIG.DEMANDES_MAX_JOUR || parEmail >= CONFIG.DEMANDES_MAX_EMAIL_JOUR) return true;
  cache.put(cles[0], String(total + 1), 21600);
  cache.put(cles[1], String(parEmail + 1), 21600);
  return false;
}

/** Montant du séjour et des coffrets, calculé ici (jamais repris du navigateur). */
function chiffrer(v, tarifs) {
  let sejour = 0;
  for (let n = v.arrivee; n < v.depart; n = ajouterJours(n, 1)) sejour += prixNuit(n, tarifs);
  const coffrets = v.coffrets.map(c => CONFIG.COFFRETS[c]);
  const total = sejour + coffrets.reduce((s, c) => s + c.prix, 0);
  return { sejour, coffrets, total };
}

function reserver(d) {
  const ctrl = valider(d);
  if (ctrl.erreur === 'robot') return { ok: true, url: CONFIG.SITE };   // on ne dit rien au robot
  if (ctrl.erreur) return { ok: false, erreur: ctrl.erreur, message: ctrl.message };
  const v = ctrl.donnees;
  if (limiteAtteinte(v.email)) return { ok: false, erreur: 'limite', message: 'Trop de demandes aujourd’hui. Merci de nous appeler au 06 31 26 98 99.' };

  const verrou = LockService.getScriptLock();
  verrou.waitLock(20000);
  let ev = null;
  try {
    // Vérification en direct dans l'agenda, sous verrou : deux clients ne
    // peuvent pas mettre de côté les mêmes nuits en même temps.
    const { reserve, tarifs } = lireAgenda(v.arrivee, v.depart);
    const prises = [];
    for (let n = v.arrivee; n < v.depart; n = ajouterJours(n, 1)) if (reserve.has(n)) prises.push(n);
    if (prises.length) return { ok: false, erreur: 'indisponible', nuits: prises, message: 'Ces dates viennent d’être réservées. Merci d’en choisir d’autres.' };

    const montant = chiffrer(v, tarifs);
    const jeton = Utilities.getUuid();
    const cree = new Date();
    ev = agenda().createEvent(`${PREFIXE_ATTENTE} – ${v.prenom} ${v.nom}`,
      dateParis(v.arrivee, CONFIG.HEURE_ARRIVEE), dateParis(v.depart, CONFIG.HEURE_DEPART),
      { description: descriptionEvenement(v, montant, { jeton, cree }) });
    try { ev.setColor(CalendarApp.EventColor.GRAY); } catch (e) { /* couleur facultative */ }

    const session = creerSessionStripe(v, montant, jeton, cree);
    ev.setDescription(descriptionEvenement(v, montant, { jeton, cree, session: session.id }));
    CacheService.getScriptCache().remove('dispos');
    return { ok: true, url: session.url };
  } catch (err) {
    if (ev) { try { ev.deleteEvent(); } catch (e) { /* déjà supprimé */ } }
    console.error(err);
    return { ok: false, erreur: 'paiement', message: 'Le paiement n’a pas pu être préparé. Merci de réessayer ou d’appeler le 06 31 26 98 99.' };
  } finally {
    verrou.releaseLock();
  }
}

function descriptionEvenement(v, montant, infos) {
  const lignes = [
    `Arrivée : ${dateLongue(v.arrivee)} (dès ${CONFIG.HEURE_ARRIVEE.replace(':00', ' h')})`,
    `Départ : ${dateLongue(v.depart)} (avant ${CONFIG.HEURE_DEPART.replace(':00', ' h')})`,
    `Nuits : ${v.nuits}`,
    v.heure ? `Heure d'arrivée prévue : ${v.heure}` : null,
    `Voyageurs : ${v.voyageurs}`,
    montant.coffrets.length ? `Coffrets : ${montant.coffrets.map(c => c.nom).join(', ')}` : null,
    `Montant : ${montant.total} € (séjour ${montant.sejour} €)`,
    '',
    `Client : ${v.prenom} ${v.nom}`,
    `Email : ${v.email}`,
    `Téléphone : ${v.tel}`,
    v.message ? `Message : ${v.message}` : null,
    '',
    infos.paye ? `Payé le : ${Utilities.formatDate(infos.paye, CONFIG.FUSEAU, 'dd/MM/yyyy HH:mm')}` : null,
    '— Informations techniques, ne pas modifier —',
    `jeton: ${infos.jeton}`,
    infos.session ? `session: ${infos.session}` : null,
    `cree: ${infos.cree.toISOString()}`,
  ];
  return lignes.filter(l => l !== null).join('\n');
}

/* ═══════════════════════════ Stripe ═══════════════════════════ */

function stripe(methode, chemin, params) {
  const cle = PropertiesService.getScriptProperties().getProperty('STRIPE_SECRET_KEY');
  if (!cle) throw new Error('Propriété STRIPE_SECRET_KEY manquante.');
  let url = 'https://api.stripe.com/v1/' + chemin;
  const options = { method: methode, headers: { Authorization: 'Bearer ' + cle }, muteHttpExceptions: true };
  if (params) {
    const corps = encoderStripe(params);
    if (methode === 'get') url += '?' + corps;
    else { options.payload = corps; options.contentType = 'application/x-www-form-urlencoded'; }
  }
  const reponse = UrlFetchApp.fetch(url, options);
  const donnees = JSON.parse(reponse.getContentText());
  if (reponse.getResponseCode() >= 400) {
    const e = new Error('Stripe : ' + ((donnees.error && donnees.error.message) || reponse.getResponseCode()));
    e.stripe = donnees.error || {};
    throw e;
  }
  return donnees;
}

/** Encodage attendu par Stripe : line_items[0][price_data][currency]=eur … */
function encoderStripe(objet, prefixe) {
  return Object.keys(objet).map(k => {
    const v = objet[k];
    const cle = prefixe ? `${prefixe}[${k}]` : k;
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') return encoderStripe(v, cle);
    return encodeURIComponent(cle) + '=' + encodeURIComponent(v);
  }).filter(Boolean).join('&');
}

function creerSessionStripe(v, montant, jeton, cree) {
  const lignes = [{
    quantity: 1,
    price_data: {
      currency: 'eur',
      unit_amount: montant.sejour * 100,
      product_data: {
        name: `Séjour au Nid de Sam, ${v.nuits} nuit${v.nuits > 1 ? 's' : ''}`,
        description: `Du ${dateLongue(v.arrivee)} au ${dateLongue(v.depart)}, ${v.voyageurs} voyageur${v.voyageurs > 1 ? 's' : ''}. Taxe de séjour comprise.`,
      },
    },
  }].concat(montant.coffrets.map(c => ({
    quantity: 1,
    price_data: { currency: 'eur', unit_amount: c.prix * 100, product_data: { name: c.nom } },
  })));
  const metadata = {
    site: MARQUE_SITE, jeton, arrivee: v.arrivee, depart: v.depart,
    prenom: v.prenom, nom: v.nom, tel: v.tel, voyageurs: String(v.voyageurs),
    heure: v.heure, coffrets: v.coffrets.join(','), message: v.message.slice(0, 480),
  };
  return stripe('post', 'checkout/sessions', {
    mode: 'payment',
    locale: 'fr',
    customer_email: v.email,
    line_items: lignes,
    // Stripe impose au moins 30 minutes ; marge d'une minute
    expires_at: Math.floor(cree.getTime() / 1000) + (CONFIG.ATTENTE_MINUTES + 1) * 60,
    success_url: CONFIG.SITE + 'merci.html?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: CONFIG.SITE + 'reservation.html?annule=' + jeton,
    metadata,
    payment_intent_data: {
      description: `Le Nid de Sam — ${v.arrivee} au ${v.depart} — ${v.prenom} ${v.nom}`,
      metadata: { site: MARQUE_SITE, jeton, arrivee: v.arrivee, depart: v.depart },
    },
  });
}

/* ═══════════════════════════ Après le paiement ═══════════════════════════ */

/** Évènement de l'agenda lié à une réservation (retrouvé grâce à son jeton). */
function trouverEvenement(jeton, arrivee, depart) {
  const debut = arrivee ? dateParis(ajouterJours(arrivee, -1)) : dateParis(aujourdhui());
  const fin = depart ? dateParis(ajouterJours(depart, 1)) : dateParis(ajouterJours(aujourdhui(), CONFIG.HORIZON_JOURS));
  const evs = agenda().getEvents(debut, fin);
  return evs.find(ev => (ev.getDescription() || '').indexOf('jeton: ' + jeton) >= 0) || null;
}

function resumeSession(s) {
  const m = s.metadata || {};
  return {
    arrivee: m.arrivee, depart: m.depart, prenom: m.prenom,
    nuits: m.arrivee && m.depart ? ecartJours(m.arrivee, m.depart) : null,
    montant: typeof s.amount_total === 'number' ? s.amount_total / 100 : null,
    email: s.customer_email || (s.customer_details && s.customer_details.email) || '',
  };
}

/**
 * Rend la réservation définitive si le paiement est passé. Appelé par la page
 * merci.html ET par verifierPaiements() : peut être appelé plusieurs fois
 * pour la même session sans créer de doublon ni renvoyer d'email.
 */
function finaliser(sessionId) {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return { ok: false, etat: 'inconnu' };
  const verrou = LockService.getScriptLock();
  verrou.waitLock(20000);
  try {
    const s = stripe('get', 'checkout/sessions/' + sessionId);
    const m = s.metadata || {};
    if (m.site !== MARQUE_SITE) return { ok: false, etat: 'inconnu' };
    const resume = resumeSession(s);
    if (s.payment_status !== 'paid') return { ok: true, etat: s.status === 'expired' ? 'expire' : 'en_attente', resume };

    let ev = trouverEvenement(m.jeton, m.arrivee, m.depart);
    const dejaReserve = !!ev && (ev.getTitle() || '').indexOf(PREFIXE_RESERVE) === 0;
    if (dejaReserve && emailsEnvoyes(ev)) return { ok: true, etat: 'confirme', resume };

    const v = {
      arrivee: m.arrivee, depart: m.depart, nuits: resume.nuits, prenom: m.prenom, nom: m.nom,
      email: resume.email, tel: m.tel, voyageurs: Number(m.voyageurs), heure: m.heure || '',
      coffrets: (m.coffrets || '').split(',').filter(c => CONFIG.COFFRETS[c]), message: m.message || '',
    };
    const montant = { total: resume.montant, sejour: resume.montant - v.coffrets.reduce((t, c) => t + CONFIG.COFFRETS[c].prix, 0), coffrets: v.coffrets.map(c => CONFIG.COFFRETS[c]) };
    const cree = ev ? new Date((((ev.getDescription() || '').match(/cree: (\S+)/) || [])[1]) || Date.now()) : new Date();

    if (!dejaReserve) {
      if (!ev) {
        // La mise de côté a disparu (supprimée à la main ?) : on vérifie que les
        // nuits sont toujours libres avant de créer la réservation.
        const { reserve } = lireAgenda(v.arrivee, v.depart);
        const prises = [];
        for (let n = v.arrivee; n < v.depart; n = ajouterJours(n, 1)) if (reserve.has(n)) prises.push(n);
        if (prises.length) {
          alerterConflit(v, montant, s);
          return { ok: true, etat: 'conflit', resume };
        }
        ev = agenda().createEvent('…', dateParis(v.arrivee, CONFIG.HEURE_ARRIVEE), dateParis(v.depart, CONFIG.HEURE_DEPART));
      }
      ev.setTitle(`${PREFIXE_RESERVE} – ${v.prenom} ${v.nom}`);
      ev.setDescription(descriptionEvenement(v, montant, { jeton: m.jeton, cree, session: s.id, paye: new Date() }));
      try { ev.setColor(CalendarApp.EventColor.GREEN); } catch (e) { /* couleur facultative */ }
      CacheService.getScriptCache().remove('dispos');
    }

    // La réservation est acquise même si un email ne part pas : l'envoi est
    // alors retenté au prochain passage (page merci ou verifierPaiements).
    try {
      envoyerConfirmation(v, montant);
      prevenirProprietaire(v, montant);
      ev.setDescription((ev.getDescription() || '') + '\n' + MARQUE_EMAILS);
    } catch (e) {
      console.error(e);
    }
    return { ok: true, etat: 'confirme', resume };
  } finally {
    verrou.releaseLock();
  }
}

/** Paiement abandonné par le client : on annule la session et on libère les dates. */
function liberer(jeton) {
  if (!/^[0-9a-f-]{36}$/i.test(jeton)) return { ok: false };
  const ev = trouverEvenement(jeton);
  if (!ev || (ev.getTitle() || '').indexOf(PREFIXE_ATTENTE) !== 0) return { ok: true };
  const session = ((ev.getDescription() || '').match(/session: (\S+)/) || [])[1];
  if (session) {
    try { stripe('post', 'checkout/sessions/' + session + '/expire'); } catch (e) { /* déjà expirée ou payée */ }
    const etat = finaliserSiPaye(session);
    if (etat === 'confirme') return { ok: true, etat };
  }
  ev.deleteEvent();
  CacheService.getScriptCache().remove('dispos');
  return { ok: true, etat: 'libere' };
}

function emailsEnvoyes(ev) {
  return (ev.getDescription() || '').indexOf(MARQUE_EMAILS) >= 0;
}
function finaliserSiPaye(sessionId) {
  try { return finaliser(sessionId).etat; } catch (e) { console.error(e); return 'erreur'; }
}

/* ═══════════════════════════ Tâche automatique (toutes les 5 minutes) ═══════════════════════════ */

function verifierPaiements() {
  // 1. Paiements des 3 dernières heures dont la réservation n'a pas encore été confirmée
  const depuis = Math.floor(Date.now() / 1000) - 3 * 3600;
  const liste = stripe('get', 'checkout/sessions', { limit: 100, created: { gte: depuis } });
  liste.data
    .filter(s => s.metadata && s.metadata.site === MARQUE_SITE && s.payment_status === 'paid')
    .forEach(s => finaliserSiPaye(s.id));

  // 2. Dates mises de côté dont le paiement n'a pas abouti à temps
  const limite = Date.now() - (CONFIG.ATTENTE_MINUTES + 5) * 60 * 1000;
  const evs = agenda().getEvents(dateParis(ajouterJours(aujourdhui(), -1)), dateParis(ajouterJours(aujourdhui(), CONFIG.HORIZON_JOURS)));
  evs.filter(ev => (ev.getTitle() || '').indexOf(PREFIXE_ATTENTE) === 0).forEach(ev => {
    const desc = ev.getDescription() || '';
    const cree = Date.parse((desc.match(/cree: (\S+)/) || [])[1] || '');
    if (cree && cree > limite) return;                         // encore dans le délai
    const session = (desc.match(/session: (\S+)/) || [])[1];
    if (session) {
      try { stripe('post', 'checkout/sessions/' + session + '/expire'); } catch (e) { /* déjà expirée ou payée */ }
      if (finaliserSiPaye(session) === 'confirme') return;
    }
    ev.deleteEvent();
  });
  CacheService.getScriptCache().remove('dispos');
}

/* ═══════════════════════════ Emails ═══════════════════════════ */

function emailProprietaire() {
  return PropertiesService.getScriptProperties().getProperty('EMAIL_PROPRIETAIRE') || Session.getEffectiveUser().getEmail();
}
const echapper = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function envoyerConfirmation(v, montant) {
  const adresse = PropertiesService.getScriptProperties().getProperty('ADRESSE') || '';
  const lignes = [
    ['Arrivée', `${dateLongue(v.arrivee)}, à partir de 16 h`],
    ['Départ', `${dateLongue(v.depart)}, avant 11 h`],
    ['Nuits', String(v.nuits)],
    ['Voyageurs', String(v.voyageurs)],
  ].concat(montant.coffrets.map(c => ['Coffret', `${c.nom} (${c.prix} €)`]))
   .concat([['Montant payé', `${montant.total} € (taxe de séjour comprise)`]]);
  const html = `
    <div style="font-family:Georgia,serif;color:#1e2225;max-width:560px">
      <p>Bonjour ${echapper(v.prenom)},</p>
      <p>Merci pour votre réservation au <b>Nid de Sam</b> : votre paiement est bien reçu et votre séjour est <b>confirmé</b>.</p>
      <table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:15px">
        ${lignes.map(([a, b]) => `<tr><td style="padding:6px 16px 6px 0;color:#585e63">${a}</td><td style="padding:6px 0">${echapper(b)}</td></tr>`).join('')}
      </table>
      ${adresse ? `<p><b>Adresse :</b> ${echapper(adresse)}</p>` : '<p>L’adresse exacte et les informations d’accès vous seront envoyées avant votre arrivée.</p>'}
      <p>Parking privé sur place. Logement non-fumeur, animaux non admis.<br>
      Une annulation moins de 48 h avant l'arrivée n'est pas remboursée.</p>
      <p>Pour toute question : 06 31 26 98 99, ou répondez simplement à cet email.</p>
      <p>À très bientôt,<br>Le Nid de Sam, Golbey</p>
    </div>`;
  MailApp.sendEmail({
    to: v.email,
    replyTo: emailProprietaire(),
    name: 'Le Nid de Sam',
    subject: `Réservation confirmée du ${dateLongue(v.arrivee)} au ${dateLongue(v.depart)}`,
    htmlBody: html,
    body: html.replace(/<[^>]+>/g, '').replace(/\n\s+/g, '\n').trim(),
  });
}

function prevenirProprietaire(v, montant) {
  MailApp.sendEmail({
    to: emailProprietaire(),
    replyTo: v.email,
    name: 'Site Le Nid de Sam',
    subject: `Nouvelle réservation payée : ${v.prenom} ${v.nom}, du ${v.arrivee} au ${v.depart}`,
    body: [
      'Nouvelle réservation payée en ligne. Elle est notée dans l’agenda « Le Nid de Sam ».', '',
      `Client : ${v.prenom} ${v.nom}`, `Email : ${v.email}`, `Téléphone : ${v.tel}`,
      `Arrivée : ${dateLongue(v.arrivee)}`, `Départ : ${dateLongue(v.depart)}`,
      `Nuits : ${v.nuits}`, `Voyageurs : ${v.voyageurs}`,
      v.heure ? `Heure d'arrivée prévue : ${v.heure}` : null,
      montant.coffrets.length ? `Coffrets : ${montant.coffrets.map(c => c.nom).join(', ')}` : null,
      `Montant payé : ${montant.total} €`,
      v.message ? `\nMessage du client :\n${v.message}` : null,
    ].filter(l => l !== null).join('\n'),
  });
}

function alerterConflit(v, montant, s) {
  MailApp.sendEmail({
    to: emailProprietaire(),
    name: 'Site Le Nid de Sam',
    subject: `⚠️ Paiement reçu sur des dates déjà prises : ${v.prenom} ${v.nom}`,
    body: [
      'Un paiement a été reçu, mais les nuits ne sont plus libres dans l’agenda.',
      'La réservation N’A PAS été créée. Contactez le client et, si besoin, remboursez-le depuis Stripe.', '',
      `Client : ${v.prenom} ${v.nom} — ${v.email} — ${v.tel}`,
      `Dates : du ${v.arrivee} au ${v.depart}`, `Montant : ${montant.total} €`, `Paiement Stripe : ${s.payment_intent || s.id}`,
    ].join('\n'),
  });
}

/* ═══════════════════════════ Installation ═══════════════════════════ */

/**
 * À lancer une fois depuis l'éditeur (bouton Exécuter) : vérifie les réglages,
 * demande les autorisations et programme verifierPaiements() toutes les 5 minutes.
 */
function installer() {
  const props = PropertiesService.getScriptProperties();
  const manque = ['STRIPE_SECRET_KEY', 'ADRESSE'].filter(k => !props.getProperty(k));
  if (manque.length) throw new Error('Propriétés du script manquantes : ' + manque.join(', '));
  agenda();                                                    // vérifie l'accès à l'agenda
  // Les réservations contiennent nom, email et téléphone du client : l'agenda
  // doit être privé. Un agenda privé ne répond pas à son adresse publique (404).
  const publique = 'https://calendar.google.com/calendar/ical/' + encodeURIComponent(CONFIG.AGENDA_ID) + '/public/basic.ics';
  if (UrlFetchApp.fetch(publique, { muteHttpExceptions: true }).getResponseCode() === 200) {
    throw new Error('L\u2019agenda « Le Nid de Sam » est encore public. Dans Google Agenda : Paramètres → Le Nid de Sam → ' +
      'Autorisations d\u2019accès aux événements → décocher « Rendre disponible publiquement », puis relancer installer().');
  }
  stripe('get', 'checkout/sessions', { limit: 1 });            // vérifie la clé Stripe
  MailApp.getRemainingDailyQuota();                            // demande l'autorisation d'envoyer les emails
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'verifierPaiements')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('verifierPaiements').timeBased().everyMinutes(5).create();
  const cle = props.getProperty('STRIPE_SECRET_KEY');
  console.log('Installation terminée. Mode Stripe : ' + (cle.indexOf('sk_live_') === 0 ? 'PAIEMENTS RÉELS' : 'essai (test)') +
    '. Avis envoyés à : ' + emailProprietaire());
}

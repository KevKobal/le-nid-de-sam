#!/usr/bin/env python3
"""Met à jour dispos.json à partir d'un ou plusieurs agendas au format iCal.

Lancé toutes les heures par la tâche GitHub .github/workflows/dispos.yml.

Les adresses des agendas sont lues dans la variable d'environnement ICAL_URLS
(séparées par des espaces ou des retours à la ligne), alimentée par le secret
CALENDRIER du dépôt. Ce sont des adresses
secrètes : elles sont stockées dans les « secrets » GitHub du dépôt et ne
doivent jamais apparaître dans le code ni dans les journaux.

Seules les DATES des réservations sont écrites dans dispos.json : aucun titre,
nom de client ni autre détail ne sort de l'agenda.

Sécurité : si un seul des agendas est illisible, le script s'arrête en erreur
SANS toucher à dispos.json. Publier des données partielles pourrait afficher
comme libres des nuits déjà réservées.

Tester en local :
    ICAL_URLS="https://…/basic.ics" python3 scripts/maj_dispos.py
ou avec un fichier :
    ICAL_URLS="file:///chemin/vers/agenda.ics" python3 scripts/maj_dispos.py
"""

import json
import os
import re
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

PARIS = ZoneInfo("Europe/Paris")
SORTIE = Path(__file__).resolve().parent.parent / "dispos.json"
HORIZON_JOURS = 550  # environ 18 mois de calendrier à venir


def lire_source(url: str) -> str:
    requete = urllib.request.Request(url, headers={"User-Agent": "le-nid-de-sam-dispos"})
    with urllib.request.urlopen(requete, timeout=30) as reponse:
        texte = reponse.read().decode("utf-8", errors="replace")
    if "BEGIN:VCALENDAR" not in texte:
        raise ValueError("la réponse n'est pas un agenda iCal")
    return texte


def deplier(texte: str) -> list[str]:
    """Recolle les lignes iCal repliées (une ligne qui commence par un espace
    ou une tabulation prolonge la précédente)."""
    lignes: list[str] = []
    for ligne in texte.replace("\r\n", "\n").split("\n"):
        if ligne[:1] in (" ", "\t") and lignes:
            lignes[-1] += ligne[1:]
        else:
            lignes.append(ligne)
    return lignes


def evenements(lignes: list[str]):
    """Renvoie, pour chaque VEVENT, un dict {NOM: (paramètres, valeur)}."""
    courant = None
    for ligne in lignes:
        if ligne == "BEGIN:VEVENT":
            courant = {}
        elif ligne == "END:VEVENT":
            if courant is not None:
                yield courant
            courant = None
        elif courant is not None and ":" in ligne:
            tete, valeur = ligne.split(":", 1)
            nom, *params = tete.split(";")
            courant.setdefault(nom.upper(), (params, valeur.strip()))


def en_date(params: list[str], valeur: str) -> tuple[date, bool]:
    """Convertit DTSTART/DTEND en date locale (Paris). Renvoie (date, journée_entière)."""
    if "VALUE=DATE" in params or re.fullmatch(r"\d{8}", valeur):
        return datetime.strptime(valeur[:8], "%Y%m%d").date(), True
    moment = datetime.strptime(valeur[:15], "%Y%m%dT%H%M%S")
    if valeur.endswith("Z"):
        moment = moment.replace(tzinfo=timezone.utc)
    else:
        tzid = next((p.split("=", 1)[1] for p in params if p.upper().startswith("TZID=")), None)
        try:
            moment = moment.replace(tzinfo=ZoneInfo(tzid) if tzid else PARIS)
        except Exception:
            moment = moment.replace(tzinfo=PARIS)
    return moment.astimezone(PARIS).date(), False


def nuits_reservees(texte: str) -> set[date]:
    """Ensemble des nuits réservées (une nuit = la date du soir d'arrivée)."""
    # Agenda saisi à la main dans Google Agenda : un évènement « toute la
    # journée » du 3 au 6 (jour d'arrivée → jour de départ) est stocké avec une
    # fin au 7. Le dernier jour affiché est donc le départ, pas une nuit.
    # Les exports Airbnb / Booking, eux, suivent la norme iCal : la fin
    # indiquée est déjà le jour de départ.
    saisie_google = "PRODID:-//Google Inc//Google Calendar" in texte
    nuits: set[date] = set()
    for ev in evenements(deplier(texte)):
        if ev.get("STATUS", ([], ""))[1].upper() == "CANCELLED" or "DTSTART" not in ev:
            continue
        debut, journee = en_date(*ev["DTSTART"])
        if "DTEND" in ev:
            fin, _ = en_date(*ev["DTEND"])
        else:
            duree = re.fullmatch(r"P(\d+)D", ev.get("DURATION", ([], ""))[1])
            fin = debut + timedelta(days=int(duree.group(1)) if duree else (1 if journee else 0))

        if journee and saisie_google and (fin - debut).days >= 2:
            fin -= timedelta(days=1)
        if fin <= debut:  # évènement dans une seule journée : bloque ce soir-là
            fin = debut + timedelta(days=1)

        jour = debut
        while jour < fin:
            nuits.add(jour)
            jour += timedelta(days=1)
    return nuits


def en_plages(nuits: list[date]) -> list[list[str]]:
    """[3, 4, 5 oct.] → [["2026-10-03", "2026-10-06"]] : première nuit, jour de départ."""
    plages: list[list[date]] = []
    for nuit in nuits:
        if plages and plages[-1][1] == nuit:
            plages[-1][1] = nuit + timedelta(days=1)
        else:
            plages.append([nuit, nuit + timedelta(days=1)])
    return [[a.isoformat(), b.isoformat()] for a, b in plages]


def main() -> int:
    urls = os.environ.get("ICAL_URLS", "").split()
    if not urls:
        print("Aucune adresse d'agenda (secret CALENDRIER du dépôt) : dispos.json n'est pas modifié.")
        return 0

    nuits: set[date] = set()
    for numero, url in enumerate(urls, 1):
        hote = urlparse(url).netloc or "fichier local"
        try:
            nuits |= nuits_reservees(lire_source(url))
        except Exception as erreur:  # ne jamais afficher l'URL : elle est secrète
            print(f"Agenda n°{numero} ({hote}) illisible : {type(erreur).__name__}. "
                  "dispos.json n'est pas modifié.", file=sys.stderr)
            return 1
        print(f"Agenda n°{numero} ({hote}) lu.")

    aujourdhui = datetime.now(PARIS).date()
    limite = aujourdhui + timedelta(days=HORIZON_JOURS)
    a_venir = sorted(n for n in nuits if aujourdhui <= n < limite)

    donnees = {"maj": aujourdhui.isoformat(), "reserve": en_plages(a_venir)}
    SORTIE.write_text(json.dumps(donnees, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(a_venir)} nuit(s) réservée(s) à venir, en {len(donnees['reserve'])} séjour(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())

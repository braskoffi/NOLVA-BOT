# NOLVA : bot Discord + panneau (depuis l’iPhone)

GitHub pour le code, Railway pour le faire tourner, GitHub Pages pour le site.

## Fichiers du dépôt « nolva-bot » (tous à la racine)
bot.py · premium.py · tickets.py · roles.py · automations.py · serveur.py · panel.py · panel.html · requirements.txt

## 1. Portail Discord (discord.com/developers/applications → NOLVA)
- **Bot** : Reset Token, active **Server Members Intent** et **Message Content Intent**, Save.
- **OAuth2** : copie le **Client Secret** (Reset Secret si besoin). Il va UNIQUEMENT dans Railway.
- **OAuth2 → Redirects** : ajoute `https://TON-DOMAINE-RAILWAY/callback` (voir étape 2), puis Save.
- **Bot / General Information** : mets `nolva-avatar.png` (avatar) et `nolva-banniere.png` (bannière).

## 2. Railway
- **Settings → Networking → Generate Domain** : c’est l’adresse publique du bot et du panneau.
- **Variables** :
  - `DISCORD_TOKEN` : le token du bot
  - `DISCORD_CLIENT_SECRET` : le Client Secret
  - `PUBLIC_URL` : `https://TON-DOMAINE-RAILWAY` (sans / à la fin)
  - `DATA_DIR` : `/data`
- **Volume** monté sur `/data`. Commande de démarrage : `python bot.py`.
- Logs : `Connecté en tant que NOLVA#… sur … serveur(s).`

## 3. Inviter le bot
https://discord.com/oauth2/authorize?client_id=1571576813761855589&permissions=1099780189270&integration_type=0&scope=bot%20applications.commands

Puis place le rôle **NOLVA** au-dessus des rôles qu’il doit gérer.

## 4. Site (dépôt « nolva-site », GitHub Pages)
Fichier `index.html`. Dans le fichier, remplace la ligne `var PANEL_URL=...` par `https://TON-DOMAINE-RAILWAY/panel`.

## Commandes
- Modération : /avertir /avertissements /muet /demuet /expulser /bannir /debannir /effacer
- Réglages : /nolva statut · fonction · salon · message · autorole · raid · deverrouiller
- Tickets : /ticket config · panneau · fermer · ajouter · retirer
- Rôles : /roles menu · reaction · supprimer
- Automatisations : /auto ajouter · liste · supprimer
- Serveur : /serveur salon_creer · salon_supprimer · salon_renommer · verrouiller · deverrouiller · lent · role_creer · role_supprimer · role_donner · role_retirer · annoncer · sondage · info

## Offres
- **Gratuit** : modération, anti-raid, anti-spam, liens, bienvenue, rôle auto, journal, panneau, 3 automatisations, 1 menu de rôles.
- **Premium (20 €/mois)** : tickets + transcription, 20 automatisations, menus de rôles illimités, commandes /serveur.
- Activer un serveur (toi seul, propriétaire du bot) : `/premium activer serveur_id jours` ; retirer : `/premium desactiver serveur_id` ; voir l'offre : `/premium statut`.

---
Déploiement relancé le 16/11/2026.

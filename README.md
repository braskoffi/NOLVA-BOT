# NOLVA : mise en ligne du bot (depuis l’iPhone)

Même méthode que pour 2KR_bot : GitHub pour le code, Railway pour le faire tourner.

## 1. Réglages sur le portail Discord

1. Ouvre discord.com/developers/applications (en version bureau dans Safari) puis l’application NOLVA.
2. Onglet **Bot** : active **Server Members Intent** et **Message Content Intent**, puis enregistre.
3. Onglet **Bot** : appuie sur **Reset Token**, copie le nouveau token dans tes notes. Ne l’envoie à personne.

## 2. Le code sur GitHub

1. Crée un dépôt privé **nolva-bot**.
2. **Add file > Upload files** : envoie `bot.py` et `requirements.txt`.

## 3. Railway

1. **New Project > Deploy from GitHub repo** : choisis `nolva-bot`.
2. Onglet **Variables** : ajoute `DISCORD_TOKEN` (ton nouveau token) et `DATA_DIR` = `/data`.
3. Ajoute un **Volume** monté sur `/data`, pour que les réglages survivent aux redémarrages.
4. Commande de démarrage : `python bot.py`.
5. Dans les **Logs**, tu dois voir : `Connecté en tant que NOLVA ...`.

## 4. Inviter le bot

Utilise ce lien (permissions limitées à ce que le bot utilise, sans le mode administrateur) :

https://discord.com/oauth2/authorize?client_id=1571576813761855589&permissions=1099780156422&integration_type=0&scope=bot%20applications.commands

Ensuite, dans **Paramètres du serveur > Rôles**, glisse le rôle **NOLVA** au-dessus des rôles qu’il doit modérer.

## 5. Premiers réglages (sur ton serveur)

- `/nolva salon` : choisis le salon du **journal** et celui de la **bienvenue**.
- `/nolva fonction` : active **anti-raid**, **anti-spam**, **journal**…
- `/nolva statut` : vérifie tout d’un coup d’œil.
- `/nolva raid` : règle le seuil (par défaut : 8 arrivées en 10 s, verrouillage 60 min).
- `/aide` : liste des commandes.

## Ce que fait chaque fonction

- **Anti-raid** : si trop de membres arrivent d’un coup, ils sont rendus muets (exclusion temporaire) et une alerte part dans le journal. `/nolva deverrouiller` les libère.
- **Anti-spam** : 6 messages en 5 s, ou 5 mentions et plus dans un message, entraînent la suppression et 5 min de mode muet. Les modérateurs sont exemptés.
- **Filtre de liens** : supprime les liens postés par les membres sans droit de gérer les messages.
- **Bienvenue** : message avec `{user}`, `{server}` et `{count}`, modifiable avec `/nolva message`.
- **Journal** : arrivées, départs, messages supprimés, sanctions et alertes.

## En cas de souci

- Les commandes n’apparaissent pas : attends quelques minutes, puis relance le service Railway.
- « Mon rôle est trop bas » : remonte le rôle NOLVA dans la liste des rôles du serveur.
- Le bot reste hors ligne : vérifie `DISCORD_TOKEN` et les deux intents du portail.

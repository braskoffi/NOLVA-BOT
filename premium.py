"""NOLVA : offre Premium (20 €/mois). L'activation d'un serveur est faite par le propriétaire du bot."""
import os
import time

import discord
from discord import app_commands

B = None  # le bot, rempli dans setup()
MSG = "⭐ Cette fonction est réservée à NOLVA Premium (20 €/mois). Fais /premium statut pour voir les offres."


# Comptes Discord qui ont NOLVA Premium à vie (on peut en ajouter via la variable PREMIUM_A_VIE_IDS, séparés par des virgules)
VIP_A_VIE = {1499081838222639115, 1433865121146343485}
VIP_A_VIE |= {int(x) for x in os.getenv("PREMIUM_A_VIE_IDS", "").replace(",", " ").split() if x.isdigit()}


def vip(user_id) -> bool:
    """Ce compte Discord a-t-il le Premium à vie ?"""
    return int(user_id) in VIP_A_VIE


def actif(gid) -> bool:
    """Un serveur est Premium s'il a un abonnement en cours, ou si son propriétaire a le Premium à vie."""
    if B.db.g(gid).get("premium_until", 0) > time.time():
        return True
    g = B.get_guild(int(gid))
    return bool(g and g.owner_id in VIP_A_VIE)


class PremiumRequis(app_commands.CheckFailure):
    pass


async def exiger(i: discord.Interaction) -> bool:
    if vip(i.user.id):
        return True  # compte Premium à vie : toutes les commandes Premium, partout
    if not actif(i.guild.id):
        raise PremiumRequis(MSG)
    return True


requis = app_commands.check(exiger)  # à poser sur une commande réservée aux abonnés

grp = app_commands.Group(name="premium", description="Offre NOLVA Premium", guild_only=True,
                         default_permissions=discord.Permissions(manage_guild=True))


@grp.command(name="statut", description="Voir l'offre de ce serveur")
async def statut(i: discord.Interaction):
    fin = B.db.g(i.guild.id).get("premium_until", 0)
    if vip(i.user.id):
        txt = "👑 **Premium à vie** : ton compte a NOLVA Premium pour toujours, sur toutes les commandes."
    elif actif(i.guild.id) and fin <= time.time():
        txt = "👑 **Premium à vie** : le propriétaire de ce serveur a NOLVA Premium pour toujours."
    elif fin > time.time():
        txt = f"⭐ **Premium** actif jusqu'au <t:{int(fin)}:D>."
    else:
        txt = ("**Offre gratuite** : modération, anti-raid, anti-spam, liens, bienvenue, rôle automatique, journal, "
               "panneau web, 3 automatisations, 1 menu de rôles.\n\n"
               "⭐ **Premium, 20 €/mois** : tickets avec transcription, 20 automatisations, menus de rôles illimités, "
               "gestion complète du serveur (/serveur).")
    await i.response.send_message(txt, ephemeral=True)


@grp.command(name="activer", description="(Propriétaire du bot) Activer Premium pour un serveur")
async def activer(i: discord.Interaction, serveur_id: str, jours: app_commands.Range[int, 1, 3650]):
    if not await B.is_owner(i.user):
        return await i.response.send_message("Réservé au propriétaire de NOLVA.", ephemeral=True)
    if not serveur_id.isdigit() or not B.get_guild(int(serveur_id)):
        return await i.response.send_message("Serveur introuvable : NOLVA doit y être.", ephemeral=True)
    c = B.db.g(int(serveur_id))
    c["premium_until"] = max(time.time(), c.get("premium_until", 0)) + jours * 86400
    B.db.save()
    await i.response.send_message(f"✅ Premium actif jusqu'au <t:{int(c['premium_until'])}:D>.", ephemeral=True)


@grp.command(name="desactiver", description="(Propriétaire du bot) Retirer Premium à un serveur")
async def desactiver(i: discord.Interaction, serveur_id: str):
    if not await B.is_owner(i.user):
        return await i.response.send_message("Réservé au propriétaire de NOLVA.", ephemeral=True)
    if not serveur_id.isdigit():
        return await i.response.send_message("Identifiant invalide.", ephemeral=True)
    B.db.g(int(serveur_id))["premium_until"] = 0
    B.db.save()
    await i.response.send_message("✅ Premium retiré.", ephemeral=True)


async def setup(bot):
    global B
    B = bot
    bot.tree.add_command(grp)

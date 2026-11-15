"""NOLVA : automatisations « quand ceci arrive, fais cela »."""
import time
import datetime as dt

import discord
from discord import app_commands

B = None  # le bot, rempli dans setup()
MAX_REGLES = 20

DECLENCHEURS = {
    "membre_rejoint": "Un membre rejoint le serveur",
    "membre_part": "Un membre quitte le serveur",
    "message_contient": "Un message contient",
}
ACTIONS = {
    "envoyer_message": "Envoyer un message",
    "message_prive": "Envoyer un message privé",
    "donner_role": "Donner un rôle",
    "retirer_role": "Retirer un rôle",
    "supprimer_message": "Supprimer le message",
    "muet": "Rendre muet",
}
# actions autorisées pour chaque déclencheur
POSSIBLE = {
    "membre_rejoint": ("envoyer_message", "message_prive", "donner_role", "retirer_role", "muet"),
    "membre_part": ("envoyer_message",),
    "message_contient": ("envoyer_message", "message_prive", "donner_role", "retirer_role", "supprimer_message", "muet"),
}
cool_regle, cool_user = {}, {}


def regles(gid):
    return B.db.g(gid).setdefault("automations", [])


def entier(v, lo, hi):
    if isinstance(v, bool):
        return None
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n if lo <= n <= hi else None


def valider(guild, d):
    """Vérifie une automatisation. Renvoie (règle propre, None) ou (None, message d'erreur)."""
    from roles import probleme_role
    if not isinstance(d, dict):
        return None, "Requête invalide."
    quand, action = d.get("quand"), d.get("action")
    if quand not in DECLENCHEURS:
        return None, "Déclencheur inconnu."
    if action not in POSSIBLE[quand]:
        return None, "Cette action n’est pas possible avec ce déclencheur."
    r = {"quand": quand, "action": action, "mot": None, "salon": None, "role": None, "texte": None, "minutes": None}
    if quand == "message_contient":
        mot = str(d.get("mot") or "").strip().lower()
        if not 1 <= len(mot) <= 100:
            return None, "Indique le mot à surveiller (100 caractères maximum)."
        r["mot"] = mot
    if action in ("envoyer_message", "message_prive"):
        texte = str(d.get("texte") or "").strip()
        if not 1 <= len(texte) <= 1500:
            return None, "Écris le texte du message (1500 caractères maximum)."
        r["texte"] = texte
    if action == "envoyer_message":
        if d.get("salon"):
            sid = entier(d["salon"], 1, 2 ** 63)
            ch = guild.get_channel(sid) if sid else None
            if not isinstance(ch, discord.TextChannel):
                return None, "Salon introuvable."
            r["salon"] = ch.id
        elif quand != "message_contient":
            return None, "Choisis le salon où envoyer le message."
    if action in ("donner_role", "retirer_role"):
        rid = entier(d.get("role"), 1, 2 ** 63)
        role = guild.get_role(rid) if rid else None
        if not role:
            return None, "Rôle introuvable."
        err = probleme_role(guild, role)
        if err:
            return None, err
        r["role"] = role.id
    if action == "muet":
        m = entier(d.get("minutes"), 1, 1440)
        if m is None:
            return None, "Durée du mode muet : de 1 à 1440 minutes."
        r["minutes"] = m
    return r, None


def ajouter_regle(guild, d):
    r, err = valider(guild, d)
    if err:
        return None, err
    liste = regles(guild.id)
    from premium import actif
    limite = MAX_REGLES if actif(guild.id) else 3
    if len(liste) >= limite:
        return None, f"Limite atteinte ({limite} automatisations)." + ("" if limite == MAX_REGLES else " ⭐ Premium : jusqu'à 20.")
    c = B.db.g(guild.id)
    r["id"] = c.get("auto_next", 1)
    c["auto_next"] = r["id"] + 1
    liste.append(r)
    B.db.save()
    return r, None


def supprimer_regle(gid, rid):
    liste = regles(gid)
    avant = len(liste)
    liste[:] = [r for r in liste if r["id"] != rid]
    if len(liste) < avant:
        B.db.save()
        return True
    return False


def decrire(guild, r):
    q = DECLENCHEURS[r["quand"]] + (f" « {r['mot']} »" if r["mot"] else "")
    a = ACTIONS[r["action"]]
    if r["salon"]:
        ch = guild.get_channel(r["salon"])
        a += f" dans #{ch.name if ch else 'salon supprimé'}"
    if r["role"]:
        ro = guild.get_role(r["role"])
        a += f" : {ro.name if ro else 'rôle supprimé'}"
    if r["minutes"]:
        a += f" ({r['minutes']} min)"
    return f"{q} → {a}"


# ---------- Exécution ----------
def formater(t, guild, membre, message):
    return (t.replace("{user}", membre.mention).replace("{server}", guild.name)
             .replace("{count}", str(guild.member_count))
             .replace("{channel}", message.channel.mention if message else ""))


def libre(gid, r, uid):
    """Anti-abus : un message automatique ne part pas en boucle."""
    now = time.time()
    if len(cool_regle) > 5000 or len(cool_user) > 5000:
        cool_regle.clear()
        cool_user.clear()
    k = (gid, r["id"])
    if now - cool_regle.get(k, 0) < 5:
        return False
    if r["quand"] == "message_contient":
        ku = (gid, r["id"], uid)
        if now - cool_user.get(ku, 0) < 30:
            return False
        cool_user[ku] = now
    cool_regle[k] = now
    return True


async def executer(guild, r, membre, message=None):
    from roles import probleme_role
    a = r["action"]
    p = membre.guild_permissions
    staff = p.manage_messages or p.administrator
    try:
        if a == "envoyer_message":
            dest = guild.get_channel(r["salon"]) if r["salon"] else (message.channel if message else None)
            if dest and libre(guild.id, r, membre.id):
                await dest.send(formater(r["texte"], guild, membre, message),
                                allowed_mentions=discord.AllowedMentions(everyone=False, roles=False, users=[membre]))
        elif a == "message_prive":
            if libre(guild.id, r, membre.id):
                await membre.send(formater(r["texte"], guild, membre, message)[:2000])
        elif a in ("donner_role", "retirer_role"):
            role = guild.get_role(r["role"])
            if role and not probleme_role(guild, role):
                if a == "donner_role":
                    await membre.add_roles(role, reason="NOLVA : automatisation")
                else:
                    await membre.remove_roles(role, reason="NOLVA : automatisation")
        elif a == "supprimer_message":
            if message and not staff:
                await message.delete()
        elif a == "muet":
            if not staff and membre.id != guild.owner_id:
                await membre.timeout(dt.timedelta(minutes=r["minutes"]), reason="NOLVA : automatisation")
    except discord.HTTPException:
        pass  # permission manquante, messages privés fermés, etc.


async def on_member_join(m):
    if m.bot:
        return
    c = B.db.g(m.guild.id)
    if c["features"]["antiraid"] and c["lock_until"] > time.time():
        return  # pendant un raid, on ne fait rien de plus
    for r in list(regles(m.guild.id)):
        if r["quand"] == "membre_rejoint":
            await executer(m.guild, r, m)


async def on_member_remove(m):
    if m.bot:
        return
    for r in list(regles(m.guild.id)):
        if r["quand"] == "membre_part":
            await executer(m.guild, r, m)


async def on_message(msg):
    if msg.author.bot or not msg.guild or not isinstance(msg.author, discord.Member) or not msg.content:
        return
    texte = msg.content.lower()
    for r in list(regles(msg.guild.id)):
        if r["quand"] == "message_contient" and r["mot"] in texte:
            await executer(msg.guild, r, msg.author, msg)


# ---------- Commandes /auto ----------
grp = app_commands.Group(name="auto", description="Automatisations : quand ceci arrive, fais cela", guild_only=True,
                         default_permissions=discord.Permissions(manage_guild=True))
ADMIN = app_commands.checks.has_permissions(manage_guild=True)


@grp.command(name="ajouter", description="Créer une automatisation")
@app_commands.choices(quand=[app_commands.Choice(name=v, value=k) for k, v in DECLENCHEURS.items()],
                      action=[app_commands.Choice(name=v, value=k) for k, v in ACTIONS.items()])
@ADMIN
async def ajouter(i: discord.Interaction, quand: app_commands.Choice[str], action: app_commands.Choice[str],
                  mot: str = None, texte: str = None, salon: discord.TextChannel = None,
                  role: discord.Role = None, minutes: app_commands.Range[int, 1, 1440] = None):
    d = {"quand": quand.value, "action": action.value, "mot": mot, "texte": texte,
         "salon": salon.id if salon else None, "role": role.id if role else None, "minutes": minutes}
    r, err = ajouter_regle(i.guild, d)
    if err:
        return await i.response.send_message(f"❌ {err}", ephemeral=True)
    await i.response.send_message(f"✅ Automatisation n°{r['id']} créée :\n{decrire(i.guild, r)}", ephemeral=True)


@grp.command(name="liste", description="Voir les automatisations du serveur")
@ADMIN
async def liste(i: discord.Interaction):
    rs = regles(i.guild.id)
    if not rs:
        return await i.response.send_message("Aucune automatisation. Crée-en une avec `/auto ajouter`.", ephemeral=True)
    txt = "\n".join(f"**{r['id']}.** {decrire(i.guild, r)}" for r in rs)
    await i.response.send_message(txt[:1900], ephemeral=True)


@grp.command(name="supprimer", description="Supprimer une automatisation grâce à son numéro")
@ADMIN
async def supprimer(i: discord.Interaction, numero: int):
    ok = supprimer_regle(i.guild.id, numero)
    await i.response.send_message("🗑️ Supprimée." if ok else "Numéro introuvable.", ephemeral=True)


async def setup(bot):
    global B
    B = bot
    bot.tree.add_command(grp)
    bot.add_listener(on_member_join, "on_member_join")
    bot.add_listener(on_member_remove, "on_member_remove")
    bot.add_listener(on_message, "on_message")

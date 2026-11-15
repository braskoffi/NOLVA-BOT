"""NOLVA : bot Discord de modération et de protection, réglable par commandes /nolva."""
import os, re, json, time, datetime as dt
from collections import defaultdict, deque
from typing import Optional

import discord
from discord import app_commands
from discord.ext import commands
from aiohttp import web

import panel

TOKEN = os.getenv("DISCORD_TOKEN")
DATA = os.getenv("DATA_DIR", "data")  # sur Railway : DATA_DIR=/data (volume)
os.makedirs(DATA, exist_ok=True)
FILE = os.path.join(DATA, "config.json")

FEATURES = {
    "antiraid": "Anti-raid",
    "antispam": "Anti-spam",
    "liens": "Filtre de liens",
    "bienvenue": "Messages de bienvenue",
    "autorole": "Rôle automatique",
    "journal": "Journal des actions",
}
DEFAULT = {
    "features": {k: False for k in FEATURES},
    "antiraid": {"seuil": 8, "fenetre": 10, "duree_min": 60},
    "channels": {"journal": None, "bienvenue": None},
    "bienvenue_msg": "Bienvenue {user} sur **{server}** ! Tu es le membre n°{count}.",
    "autorole": None,
    "warns": {},
    "raiders": [],
    "lock_until": 0,
}


class Store:
    """Réglages par serveur, enregistrés dans un fichier JSON."""

    def __init__(self):
        try:
            with open(FILE, encoding="utf-8") as f:
                self.d = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            self.d = {}

    def save(self):
        tmp = FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.d, f, ensure_ascii=False, indent=1)
        os.replace(tmp, FILE)

    def g(self, gid):
        c = self.d.setdefault(str(gid), {})
        for k, v in DEFAULT.items():
            c.setdefault(k, json.loads(json.dumps(v)))
        for k in ("features", "antiraid", "channels"):
            for kk, vv in DEFAULT[k].items():
                c[k].setdefault(kk, vv)
        return c


db = Store()
intents = discord.Intents.default()
intents.members = True
intents.message_content = True


class Nolva(commands.Bot):
    async def setup_hook(self):
        self.db, self.log = db, log  # partagés avec les modules
        for ext in ("premium", "tickets", "roles", "automations", "serveur"):
            await self.load_extension(ext)
        await self.tree.sync()
        # serveur web : page d'accueil de contrôle + panneau (/panel) + API
        app = panel.make_app(self, FEATURES)
        async def sante(request):
            return web.Response(text="NOLVA en ligne")
        app.router.add_get("/", sante)
        runner = web.AppRunner(app)
        await runner.setup()
        await web.TCPSite(runner, "0.0.0.0", int(os.getenv("PORT", "8080"))).start()


bot = Nolva(command_prefix=commands.when_mentioned, intents=intents, help_command=None)
joins = defaultdict(deque)
msgs = defaultdict(deque)
LINK = re.compile(r"(https?://|www\.|discord\.gg/|discord\.com/invite/)", re.I)


async def log(guild, text, color=0x7CF0D0):
    ch_id = db.g(guild.id)["channels"]["journal"]
    ch = guild.get_channel(ch_id) if ch_id else None
    if ch:
        try:
            await ch.send(embed=discord.Embed(description=text, color=color, timestamp=discord.utils.utcnow()))
        except discord.HTTPException:
            pass


def staff(**perms):
    """Commande réservée aux membres ayant ces permissions."""
    def deco(f):
        f = app_commands.checks.has_permissions(**perms)(f)
        f = app_commands.default_permissions(**perms)(f)
        return app_commands.guild_only()(f)
    return deco


def refus(i, m):
    if m.id == i.user.id:
        return "Tu ne peux pas te cibler toi-même."
    if m.id == i.guild.owner_id or m.top_role >= i.guild.me.top_role:
        return "Mon rôle est trop bas pour agir sur ce membre : place le rôle NOLVA plus haut."
    if i.user.id != i.guild.owner_id and m.top_role >= i.user.top_role:
        return "Ce membre est au-dessus de toi."
    return None


@bot.tree.error
async def on_error(i, e):
    if isinstance(e, app_commands.MissingPermissions):
        msg = "Tu n’as pas la permission d’utiliser cette commande."
    elif isinstance(e, app_commands.CheckFailure):
        msg = str(e) or "Tu ne peux pas utiliser cette commande ici."
    else:
        msg = "Une erreur est survenue."
        print("Erreur commande :", repr(e))
    if i.response.is_done():
        await i.followup.send(msg, ephemeral=True)
    else:
        await i.response.send_message(msg, ephemeral=True)


# ---------- Modération ----------
@bot.tree.command(name="avertir", description="Avertir un membre")
@staff(moderate_members=True)
async def avertir(i: discord.Interaction, membre: discord.Member, raison: str = "Aucune raison donnée"):
    err = refus(i, membre)
    if err:
        return await i.response.send_message(err, ephemeral=True)
    c = db.g(i.guild.id)
    w = c["warns"].setdefault(str(membre.id), [])
    w.append({"par": i.user.id, "raison": raison, "date": int(time.time())})
    db.save()
    await i.response.send_message(f"⚠️ {membre.mention} averti ({len(w)} au total) : {raison}")
    await log(i.guild, f"⚠️ {i.user.mention} a averti {membre.mention} : {raison}", 0xFFB454)


@bot.tree.command(name="avertissements", description="Voir les avertissements d’un membre")
@staff(moderate_members=True)
async def avertissements(i: discord.Interaction, membre: discord.Member):
    w = db.g(i.guild.id)["warns"].get(str(membre.id), [])
    if not w:
        return await i.response.send_message(f"{membre.mention} n’a aucun avertissement.", ephemeral=True)
    lignes = [f"{n}. <t:{x['date']}:d> : {x['raison']}" for n, x in enumerate(w[-10:], 1)]
    await i.response.send_message(f"**{len(w)} avertissement(s) pour {membre.mention}**\n" + "\n".join(lignes), ephemeral=True)


@bot.tree.command(name="muet", description="Rendre un membre muet (exclusion temporaire)")
@staff(moderate_members=True)
async def muet(i: discord.Interaction, membre: discord.Member, minutes: app_commands.Range[int, 1, 40320], raison: str = "Aucune raison donnée"):
    err = refus(i, membre)
    if err:
        return await i.response.send_message(err, ephemeral=True)
    await membre.timeout(dt.timedelta(minutes=minutes), reason=f"{i.user} : {raison}")
    await i.response.send_message(f"🔇 {membre.mention} est muet pendant {minutes} min : {raison}")
    await log(i.guild, f"🔇 {i.user.mention} a rendu {membre.mention} muet ({minutes} min) : {raison}", 0xFFB454)


@bot.tree.command(name="demuet", description="Lever le mode muet d’un membre")
@staff(moderate_members=True)
async def demuet(i: discord.Interaction, membre: discord.Member):
    await membre.timeout(None)
    await i.response.send_message(f"🔊 {membre.mention} peut de nouveau parler.")
    await log(i.guild, f"🔊 {i.user.mention} a levé le mode muet de {membre.mention}.")


@bot.tree.command(name="expulser", description="Expulser un membre")
@staff(kick_members=True)
async def expulser(i: discord.Interaction, membre: discord.Member, raison: str = "Aucune raison donnée"):
    err = refus(i, membre)
    if err:
        return await i.response.send_message(err, ephemeral=True)
    await membre.kick(reason=f"{i.user} : {raison}")
    await i.response.send_message(f"👢 {membre} a été expulsé : {raison}")
    await log(i.guild, f"👢 {i.user.mention} a expulsé **{membre}** : {raison}", 0xFF5C5C)


@bot.tree.command(name="bannir", description="Bannir un membre")
@staff(ban_members=True)
async def bannir(i: discord.Interaction, membre: discord.Member, raison: str = "Aucune raison donnée"):
    err = refus(i, membre)
    if err:
        return await i.response.send_message(err, ephemeral=True)
    await membre.ban(reason=f"{i.user} : {raison}", delete_message_days=0)
    await i.response.send_message(f"🔨 {membre} a été banni : {raison}")
    await log(i.guild, f"🔨 {i.user.mention} a banni **{membre}** : {raison}", 0xFF5C5C)


@bot.tree.command(name="debannir", description="Débannir un utilisateur grâce à son identifiant")
@staff(ban_members=True)
async def debannir(i: discord.Interaction, identifiant: str):
    if not identifiant.isdigit():
        return await i.response.send_message("L’identifiant doit être un nombre.", ephemeral=True)
    try:
        await i.guild.unban(discord.Object(id=int(identifiant)))
    except discord.NotFound:
        return await i.response.send_message("Cet utilisateur n’est pas banni.", ephemeral=True)
    await i.response.send_message("✅ Utilisateur débanni.")
    await log(i.guild, f"✅ {i.user.mention} a débanni l’identifiant `{identifiant}`.")


@bot.tree.command(name="effacer", description="Supprimer des messages du salon")
@staff(manage_messages=True)
async def effacer(i: discord.Interaction, nombre: app_commands.Range[int, 1, 100]):
    await i.response.defer(ephemeral=True)
    supprimes = await i.channel.purge(limit=nombre)
    await i.followup.send(f"🧹 {len(supprimes)} message(s) supprimé(s).", ephemeral=True)
    await log(i.guild, f"🧹 {i.user.mention} a supprimé {len(supprimes)} message(s) dans {i.channel.mention}.")


@bot.tree.command(name="aide", description="Voir ce que NOLVA sait faire")
async def aide(i: discord.Interaction):
    e = discord.Embed(title="NOLVA", color=0x7CF0D0, description="Bot de modération et de protection, réglable sans code.")
    e.add_field(name="Modération", value="/avertir · /avertissements · /muet · /demuet · /expulser · /bannir · /debannir · /effacer", inline=False)
    e.add_field(name="Réglages (administrateurs)", value="/nolva statut · fonction · salon · message · autorole · raid · deverrouiller", inline=False)
    e.add_field(name="Tickets", value="/ticket panneau · config · fermer · ajouter · retirer", inline=False)
    e.add_field(name="Rôles", value="/roles menu · reaction · supprimer", inline=False)
    e.add_field(name="Premium", value="/premium statut", inline=False)
    e.add_field(name="Automatisations", value="/auto ajouter · liste · supprimer", inline=False)
    e.add_field(name="Gestion du serveur", value="/serveur salon_creer · salon_supprimer · salon_renommer · verrouiller · deverrouiller · lent · role_creer · role_supprimer · role_donner · role_retirer · annoncer · sondage · info", inline=False)
    await i.response.send_message(embed=e, ephemeral=True)


# ---------- Réglages ----------
nolva = app_commands.Group(name="nolva", description="Régler NOLVA sur ce serveur", guild_only=True,
                           default_permissions=discord.Permissions(manage_guild=True))
bot.tree.add_command(nolva)
ADMIN = app_commands.checks.has_permissions(manage_guild=True)


@nolva.command(name="statut", description="Voir les réglages actuels")
@ADMIN
async def statut(i: discord.Interaction):
    c = db.g(i.guild.id)
    f = "\n".join(f"{'✅' if c['features'][k] else '❌'} {v}" for k, v in FEATURES.items())
    ch = c["channels"]
    ar = c["antiraid"]
    e = discord.Embed(title="Réglages de NOLVA", color=0x7CF0D0, description=f)
    e.add_field(name="Salons", value=f"Journal : {'<#%s>' % ch['journal'] if ch['journal'] else 'non défini'}\nBienvenue : {'<#%s>' % ch['bienvenue'] if ch['bienvenue'] else 'non défini'}", inline=False)
    e.add_field(name="Anti-raid", value=f"{ar['seuil']} arrivées en {ar['fenetre']} s, verrouillage {ar['duree_min']} min", inline=False)
    await i.response.send_message(embed=e, ephemeral=True)


@nolva.command(name="fonction", description="Activer ou désactiver une fonction")
@app_commands.choices(nom=[app_commands.Choice(name=v, value=k) for k, v in FEATURES.items()])
@ADMIN
async def fonction(i: discord.Interaction, nom: app_commands.Choice[str], actif: bool):
    c = db.g(i.guild.id)
    c["features"][nom.value] = actif
    db.save()
    note = ""
    if actif and nom.value in ("journal", "bienvenue") and not c["channels"][nom.value]:
        note = f"\nPense à choisir le salon avec `/nolva salon`."
    if actif and nom.value == "autorole" and not c["autorole"]:
        note = "\nPense à choisir le rôle avec `/nolva autorole`."
    await i.response.send_message(f"{'✅' if actif else '❌'} **{nom.name}** {'activé' if actif else 'désactivé'}.{note}", ephemeral=True)


@nolva.command(name="salon", description="Choisir le salon du journal ou de la bienvenue")
@app_commands.choices(type=[app_commands.Choice(name="Journal", value="journal"), app_commands.Choice(name="Bienvenue", value="bienvenue")])
@ADMIN
async def salon(i: discord.Interaction, type: app_commands.Choice[str], salon: discord.TextChannel):
    c = db.g(i.guild.id)
    c["channels"][type.value] = salon.id
    db.save()
    await i.response.send_message(f"Salon **{type.name}** : {salon.mention}", ephemeral=True)


@nolva.command(name="message", description="Écrire le message de bienvenue ({user}, {server}, {count})")
@ADMIN
async def message(i: discord.Interaction, texte: str):
    db.g(i.guild.id)["bienvenue_msg"] = texte[:1500]
    db.save()
    await i.response.send_message("Message de bienvenue enregistré.", ephemeral=True)


@nolva.command(name="autorole", description="Choisir le rôle donné à chaque nouveau membre")
@ADMIN
async def autorole(i: discord.Interaction, role: discord.Role):
    if role.managed or role >= i.guild.me.top_role:
        return await i.response.send_message("Je ne peux pas donner ce rôle : place le rôle NOLVA plus haut.", ephemeral=True)
    db.g(i.guild.id)["autorole"] = role.id
    db.save()
    await i.response.send_message(f"Rôle automatique : {role.mention}", ephemeral=True)


@nolva.command(name="raid", description="Régler l’anti-raid")
@ADMIN
async def raid(i: discord.Interaction, seuil: Optional[app_commands.Range[int, 3, 50]] = None,
               fenetre: Optional[app_commands.Range[int, 3, 120]] = None,
               duree_min: Optional[app_commands.Range[int, 1, 1440]] = None):
    ar = db.g(i.guild.id)["antiraid"]
    for k, v in (("seuil", seuil), ("fenetre", fenetre), ("duree_min", duree_min)):
        if v is not None:
            ar[k] = v
    db.save()
    await i.response.send_message(f"Anti-raid : {ar['seuil']} arrivées en {ar['fenetre']} s, verrouillage {ar['duree_min']} min.", ephemeral=True)


@nolva.command(name="deverrouiller", description="Mettre fin au verrouillage anti-raid")
@ADMIN
async def deverrouiller(i: discord.Interaction):
    c = db.g(i.guild.id)
    c["lock_until"] = 0
    await i.response.defer(ephemeral=True)
    n = 0
    for uid in c["raiders"]:
        m = i.guild.get_member(uid)
        if m:
            try:
                await m.timeout(None, reason="NOLVA : fin du verrouillage")
                n += 1
            except discord.HTTPException:
                pass
    c["raiders"] = []
    db.save()
    await i.followup.send(f"🔓 Verrouillage levé. {n} membre(s) libéré(s).", ephemeral=True)
    await log(i.guild, f"🔓 {i.user.mention} a levé le verrouillage anti-raid.")


# ---------- Événements ----------
async def punir_raider(m, c):
    try:
        await m.timeout(dt.timedelta(minutes=c["antiraid"]["duree_min"]), reason="NOLVA : anti-raid")
        if m.id not in c["raiders"]:
            c["raiders"].append(m.id)
    except discord.HTTPException:
        pass


@bot.event
async def on_member_join(m: discord.Member):
    g, c, now = m.guild, db.g(m.guild.id), time.time()
    if c["features"]["antiraid"]:
        ar, q = c["antiraid"], joins[g.id]
        q.append((now, m.id))
        while q and now - q[0][0] > ar["fenetre"]:
            q.popleft()
        if c["lock_until"] > now:
            await punir_raider(m, c)
            db.save()
            return
        if len(q) >= ar["seuil"]:
            c["lock_until"] = now + ar["duree_min"] * 60
            await log(g, f"🚨 **Raid probable** : {len(q)} arrivées en {ar['fenetre']} s. Les nouveaux sont rendus muets {ar['duree_min']} min. `/nolva deverrouiller` pour lever.", 0xFF5C5C)
            for _, uid in list(q):
                mem = g.get_member(uid)
                if mem:
                    await punir_raider(mem, c)
            q.clear()
            db.save()
            return
    if c["features"]["journal"]:
        await log(g, f"📥 {m.mention} a rejoint le serveur.")
    if c["features"]["autorole"] and c["autorole"]:
        role = g.get_role(c["autorole"])
        if role:
            try:
                await m.add_roles(role, reason="NOLVA : rôle automatique")
            except discord.HTTPException:
                pass
    if c["features"]["bienvenue"] and c["channels"]["bienvenue"]:
        ch = g.get_channel(c["channels"]["bienvenue"])
        if ch:
            txt = c["bienvenue_msg"].replace("{user}", m.mention).replace("{server}", g.name).replace("{count}", str(g.member_count))
            try:
                await ch.send(txt)
            except discord.HTTPException:
                pass


@bot.event
async def on_member_remove(m: discord.Member):
    if db.g(m.guild.id)["features"]["journal"]:
        await log(m.guild, f"📤 **{m}** a quitté le serveur.")


@bot.event
async def on_message_delete(msg: discord.Message):
    if msg.guild and not msg.author.bot and db.g(msg.guild.id)["features"]["journal"]:
        await log(msg.guild, f"🗑️ Message de {msg.author.mention} supprimé dans {msg.channel.mention} :\n{msg.content[:500] or '(sans texte)'}", 0xFFB454)


@bot.event
async def on_message(msg: discord.Message):
    if msg.author.bot or not msg.guild or not isinstance(msg.author, discord.Member):
        return
    p = msg.author.guild_permissions
    if p.administrator or p.manage_messages:
        return
    c = db.g(msg.guild.id)
    if c["features"]["antispam"]:
        k, now = (msg.guild.id, msg.author.id), time.time()
        q = msgs[k]
        q.append(now)
        while q and now - q[0] > 5:
            q.popleft()
        if len(q) >= 6 or len(msg.mentions) + len(msg.role_mentions) >= 5:
            q.clear()
            try:
                await msg.delete()
                await msg.author.timeout(dt.timedelta(minutes=5), reason="NOLVA : anti-spam")
            except discord.HTTPException:
                pass
            await log(msg.guild, f"🛡️ Spam détecté : {msg.author.mention} rendu muet 5 min.", 0xFFB454)
            return
    if c["features"]["liens"] and LINK.search(msg.content):
        try:
            await msg.delete()
            await msg.channel.send(f"{msg.author.mention}, les liens ne sont pas autorisés ici.", delete_after=6)
        except discord.HTTPException:
            pass


@bot.event
async def on_ready():
    await bot.change_presence(activity=discord.Game("/aide · NOLVA"))
    print(f"Connecté en tant que {bot.user} sur {len(bot.guilds)} serveur(s).")


if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("Variable DISCORD_TOKEN manquante.")
    bot.run(TOKEN)

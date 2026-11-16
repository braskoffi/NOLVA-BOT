"""NOLVA : menus de rôles (menu de sélection) et rôles par réactions."""
import discord
from discord import app_commands

COLOR = 0xA066FF
B = None  # le bot, rempli dans setup()

# Un rôle avec une de ces permissions ne peut JAMAIS être donné par un menu ou une réaction
INTERDITES = ("administrator", "manage_guild", "manage_roles", "manage_channels", "kick_members",
              "ban_members", "moderate_members", "manage_messages", "manage_webhooks", "mention_everyone")


def rcfg(gid):
    r = B.db.g(gid).setdefault("roles", {})
    r.setdefault("menus", {})      # id du message -> {"roles": [ids], "unique": bool}
    r.setdefault("reactions", {})  # id du message -> {emoji: id du rôle}
    return r


def norm(e: str) -> str:
    return e.strip().replace("\ufe0f", "")


def probleme_role(guild: discord.Guild, role: discord.Role):
    """Renvoie un texte d'erreur si NOLVA ne doit pas donner ce rôle, sinon None."""
    if role.is_default() or role.managed:
        return f"**{role.name}** est géré par Discord ou une intégration."
    if role >= guild.me.top_role:
        return f"**{role.name}** est au-dessus de NOLVA : place le rôle NOLVA plus haut."
    if any(getattr(role.permissions, p) for p in INTERDITES):
        return f"**{role.name}** a des permissions de gestion : interdit dans les menus."
    return None


# ---------- Menu de sélection (persistant) ----------
class MenuSelect(discord.ui.Select):
    def __init__(self, options, unique=False):
        super().__init__(custom_id="nolva:roles:menu", placeholder="Choisis tes rôles…", options=options,
                         min_values=0, max_values=1 if unique else len(options))

    async def callback(self, i: discord.Interaction):
        info = rcfg(i.guild.id)["menus"].get(str(i.message.id))
        if not info:
            return await i.response.send_message("Ce menu n’est plus actif.", ephemeral=True)
        choisis = {int(v) for v in self.values}
        ajouts, retraits = [], []
        for rid in info["roles"]:
            role = i.guild.get_role(rid)
            if not role or probleme_role(i.guild, role):
                continue
            if rid in choisis and role not in i.user.roles:
                ajouts.append(role)
            elif rid not in choisis and role in i.user.roles:
                retraits.append(role)
        await i.response.defer(ephemeral=True)
        try:
            if ajouts:
                await i.user.add_roles(*ajouts, reason="NOLVA : menu de rôles")
            if retraits:
                await i.user.remove_roles(*retraits, reason="NOLVA : menu de rôles")
        except discord.HTTPException:
            return await i.followup.send("Je n’ai pas pu modifier tes rôles : NOLVA doit être placé plus haut.", ephemeral=True)
        txt = []
        if ajouts:
            txt.append("➕ " + ", ".join(r.name for r in ajouts))
        if retraits:
            txt.append("➖ " + ", ".join(r.name for r in retraits))
        await i.followup.send("\n".join(txt) or "Rien à changer.", ephemeral=True)


class MenuView(discord.ui.View):
    def __init__(self, options, unique=False):
        super().__init__(timeout=None)
        self.add_item(MenuSelect(options, unique))


# ---------- Commandes /roles ----------
grp = app_commands.Group(name="roles", description="Menus de rôles et rôles par réactions", guild_only=True,
                         default_permissions=discord.Permissions(manage_roles=True))
GERER = app_commands.checks.has_permissions(manage_roles=True)


def droit_sur(i, role):
    """Le membre ne peut pas proposer un rôle plus haut que le sien."""
    if i.user.id != i.guild.owner_id and role >= i.user.top_role:
        return f"**{role.name}** est au-dessus de ton rôle."
    return probleme_role(i.guild, role)


@grp.command(name="menu", description="Envoyer un menu de sélection de rôles")
@GERER
async def menu(i: discord.Interaction, role1: discord.Role, role2: discord.Role = None, role3: discord.Role = None,
               role4: discord.Role = None, role5: discord.Role = None, role6: discord.Role = None,
               salon: discord.TextChannel = None, titre: str = "Choisis tes rôles",
               texte: str = "Ouvre le menu ci-dessous pour prendre ou retirer des rôles.",
               un_seul: bool = False):
    from premium import actif
    if not actif(i.guild.id) and len(rcfg(i.guild.id)["menus"]) >= 1:
        return await i.response.send_message("⭐ Offre gratuite : 1 menu de rôles. Passe en Premium pour en créer autant que tu veux.", ephemeral=True)
    roles = []
    for r in (role1, role2, role3, role4, role5, role6):
        if r and r not in roles:
            roles.append(r)
    for r in roles:
        err = droit_sur(i, r)
        if err:
            return await i.response.send_message(err, ephemeral=True)
    salon = salon or i.channel
    options = [discord.SelectOption(label=r.name[:100], value=str(r.id)) for r in roles]
    e = discord.Embed(title=titre[:200], description=texte[:1500], color=COLOR)
    try:
        msg = await salon.send(embed=e, view=MenuView(options, un_seul))
    except discord.HTTPException:
        return await i.response.send_message("Je ne peux pas écrire dans ce salon.", ephemeral=True)
    rcfg(i.guild.id)["menus"][str(msg.id)] = {"roles": [r.id for r in roles], "unique": un_seul}
    B.db.save()
    await i.response.send_message(f"✅ Menu envoyé dans {salon.mention} ({len(roles)} rôle(s)).", ephemeral=True)


@grp.command(name="reaction", description="Lier un emoji à un rôle sur un message (à utiliser dans le salon du message)")
@GERER
async def reaction(i: discord.Interaction, message_id: str, emoji: str, role: discord.Role):
    err = droit_sur(i, role)
    if err:
        return await i.response.send_message(err, ephemeral=True)
    if not message_id.isdigit():
        return await i.response.send_message("L’identifiant du message doit être un nombre.", ephemeral=True)
    try:
        msg = await i.channel.fetch_message(int(message_id))
        await msg.add_reaction(emoji.strip())
    except discord.NotFound:
        return await i.response.send_message("Message introuvable : utilise la commande dans le salon du message.", ephemeral=True)
    except discord.HTTPException:
        return await i.response.send_message("Emoji invalide, ou NOLVA n’a pas la permission « Ajouter des réactions ».", ephemeral=True)
    rcfg(i.guild.id)["reactions"].setdefault(message_id, {})[norm(emoji)] = role.id
    B.db.save()
    await i.response.send_message(f"✅ {emoji} → {role.mention}", ephemeral=True,
                                  allowed_mentions=discord.AllowedMentions.none())


@grp.command(name="supprimer", description="Désactiver le menu ou les réactions d'un message")
@GERER
async def supprimer(i: discord.Interaction, message_id: str):
    r = rcfg(i.guild.id)
    a = r["menus"].pop(message_id, None)
    b = r["reactions"].pop(message_id, None)
    B.db.save()
    await i.response.send_message("🗑️ Désactivé." if (a or b) else "Aucun menu ni réaction pour ce message.", ephemeral=True)


# ---------- Rôles par réactions ----------
async def _reaction(p: discord.RawReactionActionEvent, ajouter: bool):
    if not p.guild_id:
        return
    liens = rcfg(p.guild_id)["reactions"].get(str(p.message_id))
    if not liens:
        return
    rid = liens.get(norm(str(p.emoji)))
    guild = B.get_guild(p.guild_id)
    if not rid or not guild:
        return
    membre = p.member if ajouter else guild.get_member(p.user_id)
    role = guild.get_role(rid)
    if not membre or membre.bot or not role or probleme_role(guild, role):
        return
    try:
        if ajouter:
            await membre.add_roles(role, reason="NOLVA : rôle par réaction")
        else:
            await membre.remove_roles(role, reason="NOLVA : rôle par réaction")
    except discord.HTTPException:
        pass


async def on_raw_reaction_add(p):
    await _reaction(p, True)


async def on_raw_reaction_remove(p):
    await _reaction(p, False)


async def on_raw_message_delete(p):
    """Message supprimé : on oublie son menu et ses réactions."""
    if p.guild_id:
        r = rcfg(p.guild_id)
        a = r["menus"].pop(str(p.message_id), None)
        b = r["reactions"].pop(str(p.message_id), None)
        if a or b:
            B.db.save()


async def setup(bot):
    global B
    B = bot
    bot.add_view(MenuView([discord.SelectOption(label="x", value="0")]))
    bot.tree.add_command(grp)
    bot.add_listener(on_raw_reaction_add, "on_raw_reaction_add")
    bot.add_listener(on_raw_reaction_remove, "on_raw_reaction_remove")
    bot.add_listener(on_raw_message_delete, "on_raw_message_delete")

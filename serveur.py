"""NOLVA : gérer tout le serveur avec des commandes /serveur."""
import discord
from discord import app_commands

import premium

B = None  # le bot, rempli dans setup()
COLOR = 0x7CF0D0
CHIFFRES = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"]

grp = app_commands.Group(name="serveur", description="Gérer le serveur avec NOLVA", guild_only=True,
                         default_permissions=discord.Permissions(manage_guild=True))


def perm(**p):
    """Droit Discord requis + abonnement Premium."""
    def d(f):
        return premium.requis(app_commands.checks.has_permissions(**p)(f))
    return d


def probleme_role(i, role):
    """Un membre ne peut agir que sur des rôles en dessous du sien et de NOLVA."""
    if role.is_default() or role.managed:
        return "Ce rôle est géré par Discord ou une intégration."
    if role >= i.guild.me.top_role:
        return "Ce rôle est au-dessus de NOLVA : place le rôle NOLVA plus haut."
    if i.user.id != i.guild.owner_id and role >= i.user.top_role:
        return "Ce rôle est au-dessus de ton rôle."
    return None


class Confirmer(discord.ui.View):
    def __init__(self, user_id):
        super().__init__(timeout=30)
        self.user_id = user_id
        self.ok = False

    async def interaction_check(self, i: discord.Interaction) -> bool:
        if i.user.id != self.user_id:
            await i.response.send_message("Cette confirmation n’est pas pour toi.", ephemeral=True)
            return False
        return True

    @discord.ui.button(label="Confirmer", style=discord.ButtonStyle.danger)
    async def oui(self, i: discord.Interaction, button: discord.ui.Button):
        self.ok = True
        await i.response.defer()
        self.stop()

    @discord.ui.button(label="Annuler", style=discord.ButtonStyle.secondary)
    async def non(self, i: discord.Interaction, button: discord.ui.Button):
        await i.response.defer()
        self.stop()


async def confirmer(i: discord.Interaction, texte: str) -> bool:
    v = Confirmer(i.user.id)
    await i.response.send_message(texte, view=v, ephemeral=True)
    await v.wait()
    try:
        await i.edit_original_response(content="Confirmé." if v.ok else "Annulé.", view=None)
    except discord.HTTPException:
        pass
    return v.ok


async def echec(i, msg="Action refusée par Discord : vérifie les permissions et la position du rôle NOLVA."):
    if i.response.is_done():
        await i.followup.send(msg, ephemeral=True)
    else:
        await i.response.send_message(msg, ephemeral=True)


# ---------- Salons ----------
@grp.command(name="salon_creer", description="Créer un salon")
@app_commands.choices(type=[app_commands.Choice(name="Texte", value="texte"), app_commands.Choice(name="Vocal", value="vocal")])
@perm(manage_channels=True)
async def salon_creer(i: discord.Interaction, nom: app_commands.Range[str, 1, 100], type: app_commands.Choice[str],
                      categorie: discord.CategoryChannel = None, prive: bool = False):
    ow = {}
    if prive:
        ow = {i.guild.default_role: discord.PermissionOverwrite(view_channel=False),
              i.guild.me: discord.PermissionOverwrite(view_channel=True, manage_channels=True),
              i.user: discord.PermissionOverwrite(view_channel=True)}
    try:
        if type.value == "texte":
            ch = await i.guild.create_text_channel(nom, category=categorie, overwrites=ow, reason=f"NOLVA : {i.user}")
        else:
            ch = await i.guild.create_voice_channel(nom, category=categorie, overwrites=ow, reason=f"NOLVA : {i.user}")
    except discord.HTTPException:
        return await echec(i)
    await i.response.send_message(f"✅ Salon créé : {ch.mention}", ephemeral=True)
    await B.log(i.guild, f"📁 {i.user.mention} a créé le salon {ch.mention}.")


@grp.command(name="salon_supprimer", description="Supprimer un salon (avec confirmation)")
@perm(manage_channels=True)
async def salon_supprimer(i: discord.Interaction, salon: discord.abc.GuildChannel):
    if not await confirmer(i, f"Supprimer définitivement **{salon.name}** ?"):
        return
    nom = salon.name
    try:
        await salon.delete(reason=f"NOLVA : {i.user}")
    except discord.HTTPException:
        return await echec(i)
    await B.log(i.guild, f"🗑️ {i.user.mention} a supprimé le salon **{nom}**.", 0xFF5C5C)


@grp.command(name="salon_renommer", description="Renommer un salon")
@perm(manage_channels=True)
async def salon_renommer(i: discord.Interaction, salon: discord.abc.GuildChannel, nom: app_commands.Range[str, 1, 100]):
    try:
        await salon.edit(name=nom, reason=f"NOLVA : {i.user}")
    except discord.HTTPException:
        return await echec(i)
    await i.response.send_message(f"✅ Salon renommé : {salon.mention}", ephemeral=True)


@grp.command(name="verrouiller", description="Empêcher les membres d’écrire dans un salon")
@perm(manage_channels=True)
async def verrouiller(i: discord.Interaction, salon: discord.TextChannel = None):
    salon = salon or i.channel
    if not isinstance(salon, discord.TextChannel):
        return await i.response.send_message("Choisis un salon textuel.", ephemeral=True)
    try:
        await salon.set_permissions(i.guild.default_role, send_messages=False, reason=f"NOLVA : {i.user}")
    except discord.HTTPException:
        return await echec(i)
    await i.response.send_message(f"🔒 {salon.mention} est verrouillé.")
    await B.log(i.guild, f"🔒 {i.user.mention} a verrouillé {salon.mention}.", 0xFFB454)


@grp.command(name="deverrouiller", description="Rendre la parole dans un salon")
@perm(manage_channels=True)
async def deverrouiller_salon(i: discord.Interaction, salon: discord.TextChannel = None):
    salon = salon or i.channel
    if not isinstance(salon, discord.TextChannel):
        return await i.response.send_message("Choisis un salon textuel.", ephemeral=True)
    try:
        await salon.set_permissions(i.guild.default_role, send_messages=None, reason=f"NOLVA : {i.user}")
    except discord.HTTPException:
        return await echec(i)
    await i.response.send_message(f"🔓 {salon.mention} est déverrouillé.")
    await B.log(i.guild, f"🔓 {i.user.mention} a déverrouillé {salon.mention}.")


@grp.command(name="lent", description="Régler le mode lent d’un salon (0 pour l’enlever)")
@perm(manage_channels=True)
async def lent(i: discord.Interaction, secondes: app_commands.Range[int, 0, 21600], salon: discord.TextChannel = None):
    salon = salon or i.channel
    if not isinstance(salon, discord.TextChannel):
        return await i.response.send_message("Choisis un salon textuel.", ephemeral=True)
    try:
        await salon.edit(slowmode_delay=secondes, reason=f"NOLVA : {i.user}")
    except discord.HTTPException:
        return await echec(i)
    await i.response.send_message(f"🐢 Mode lent de {salon.mention} : {secondes} s." if secondes else f"✅ Mode lent retiré dans {salon.mention}.")


# ---------- Rôles ----------
def couleur(txt):
    if not txt:
        return discord.Colour.default()
    t = txt.strip().lstrip("#")
    if len(t) != 6:
        return None
    try:
        return discord.Colour(int(t, 16))
    except ValueError:
        return None


@grp.command(name="role_creer", description="Créer un rôle (sans permissions)")
@perm(manage_roles=True)
async def role_creer(i: discord.Interaction, nom: app_commands.Range[str, 1, 100], couleur_hex: str = None,
                     afficher_separement: bool = False):
    c = couleur(couleur_hex)
    if c is None:
        return await i.response.send_message("Couleur invalide : écris par exemple `#3B82F6`.", ephemeral=True)
    try:
        role = await i.guild.create_role(name=nom, colour=c, hoist=afficher_separement, reason=f"NOLVA : {i.user}")
    except discord.HTTPException:
        return await echec(i)
    await i.response.send_message(f"✅ Rôle créé : {role.mention}", ephemeral=True)
    await B.log(i.guild, f"🏷️ {i.user.mention} a créé le rôle {role.mention}.")


@grp.command(name="role_supprimer", description="Supprimer un rôle (avec confirmation)")
@perm(manage_roles=True)
async def role_supprimer(i: discord.Interaction, role: discord.Role):
    err = probleme_role(i, role)
    if err:
        return await i.response.send_message(err, ephemeral=True)
    if not await confirmer(i, f"Supprimer définitivement le rôle **{role.name}** ?"):
        return
    nom = role.name
    try:
        await role.delete(reason=f"NOLVA : {i.user}")
    except discord.HTTPException:
        return await echec(i)
    await B.log(i.guild, f"🗑️ {i.user.mention} a supprimé le rôle **{nom}**.", 0xFF5C5C)


@grp.command(name="role_donner", description="Donner un rôle à un membre")
@perm(manage_roles=True)
async def role_donner(i: discord.Interaction, membre: discord.Member, role: discord.Role):
    err = probleme_role(i, role)
    if err:
        return await i.response.send_message(err, ephemeral=True)
    try:
        await membre.add_roles(role, reason=f"NOLVA : {i.user}")
    except discord.HTTPException:
        return await echec(i)
    await i.response.send_message(f"✅ {role.mention} donné à {membre.mention}.", ephemeral=True,
                                  allowed_mentions=discord.AllowedMentions.none())
    await B.log(i.guild, f"🏷️ {i.user.mention} a donné {role.mention} à {membre.mention}.")


@grp.command(name="role_retirer", description="Retirer un rôle à un membre")
@perm(manage_roles=True)
async def role_retirer(i: discord.Interaction, membre: discord.Member, role: discord.Role):
    err = probleme_role(i, role)
    if err:
        return await i.response.send_message(err, ephemeral=True)
    try:
        await membre.remove_roles(role, reason=f"NOLVA : {i.user}")
    except discord.HTTPException:
        return await echec(i)
    await i.response.send_message(f"✅ {role.mention} retiré à {membre.mention}.", ephemeral=True,
                                  allowed_mentions=discord.AllowedMentions.none())
    await B.log(i.guild, f"🏷️ {i.user.mention} a retiré {role.mention} à {membre.mention}.")


# ---------- Communication ----------
@grp.command(name="annoncer", description="Publier une annonce dans un salon")
@perm(manage_messages=True)
async def annoncer(i: discord.Interaction, salon: discord.TextChannel, texte: app_commands.Range[str, 1, 3500],
                   titre: app_commands.Range[str, 1, 200] = None):
    e = discord.Embed(title=titre, description=texte, color=COLOR)
    try:
        await salon.send(embed=e, allowed_mentions=discord.AllowedMentions.none())
    except discord.HTTPException:
        return await i.response.send_message("Je ne peux pas écrire dans ce salon.", ephemeral=True)
    await i.response.send_message(f"✅ Annonce publiée dans {salon.mention}.", ephemeral=True)


@grp.command(name="sondage", description="Lancer un sondage (2 à 5 choix) dans ce salon")
@perm(manage_messages=True)
async def sondage(i: discord.Interaction, question: app_commands.Range[str, 1, 240],
                  option1: app_commands.Range[str, 1, 100], option2: app_commands.Range[str, 1, 100],
                  option3: app_commands.Range[str, 1, 100] = None, option4: app_commands.Range[str, 1, 100] = None,
                  option5: app_commands.Range[str, 1, 100] = None):
    opts = [o for o in (option1, option2, option3, option4, option5) if o]
    e = discord.Embed(title="📊 " + question, color=COLOR,
                      description="\n".join(f"{CHIFFRES[n]} {o}" for n, o in enumerate(opts)))
    e.set_footer(text=f"Sondage lancé par {i.user.display_name}")
    await i.response.send_message(embed=e)
    msg = await i.original_response()
    for n in range(len(opts)):
        try:
            await msg.add_reaction(CHIFFRES[n])
        except discord.HTTPException:
            break


@grp.command(name="info", description="Voir les informations du serveur")
async def info(i: discord.Interaction):
    g = i.guild
    e = discord.Embed(title=g.name, color=COLOR)
    e.add_field(name="Membres", value=str(g.member_count))
    e.add_field(name="Salons", value=f"{len(g.text_channels)} textuels · {len(g.voice_channels)} vocaux")
    e.add_field(name="Rôles", value=str(len(g.roles)))
    e.add_field(name="Création", value=f"<t:{int(g.created_at.timestamp())}:D>")
    e.add_field(name="Propriétaire", value=f"<@{g.owner_id}>")
    await i.response.send_message(embed=e, ephemeral=True)


async def setup(bot):
    global B
    B = bot
    bot.tree.add_command(grp)

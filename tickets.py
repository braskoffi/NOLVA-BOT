"""NOLVA : tickets (bouton, salon privé, transcription)."""
import io
import asyncio
import datetime as dt

import discord
from discord import app_commands

import premium

COLOR = 0xA066FF
DEFAUT = {"categorie": None, "role_staff": None, "transcriptions": None, "compteur": 0, "ouverts": {}}
B = None  # le bot, rempli dans setup()
en_fermeture = set()


def cfg(gid):
    """Réglages des tickets d'un serveur (créés au besoin)."""
    t = B.db.g(gid).setdefault("tickets", {})
    for k, v in DEFAUT.items():
        t.setdefault(k, {} if isinstance(v, dict) else v)
    return t


def est_staff(m: discord.Member, t) -> bool:
    if m.guild_permissions.manage_channels:
        return True
    return bool(t["role_staff"]) and any(r.id == t["role_staff"] for r in m.roles)


# ---------- Fermeture + transcription ----------
async def fermer_ticket(ch: discord.TextChannel, par: discord.Member):
    if ch.id in en_fermeture:
        return
    en_fermeture.add(ch.id)
    g = ch.guild
    t = cfg(g.id)
    info = t["ouverts"].get(str(ch.id), {})
    lignes = [f"Transcription du ticket n°{info.get('num', '?')} · serveur {g.name}",
              f"Fermé par {par} le {dt.datetime.utcnow():%Y-%m-%d %H:%M} UTC", "=" * 50]
    async for m in ch.history(limit=5000, oldest_first=True):
        heure = m.created_at.strftime("%Y-%m-%d %H:%M")
        texte = m.content or ""
        for e in m.embeds:
            if e.description:
                texte += f" [embed] {e.description}"
        for a in m.attachments:
            texte += f" [fichier] {a.url}"
        if texte.strip():
            lignes.append(f"[{heure}] {m.author} : {texte}")
    data = "\n".join(lignes).encode("utf-8")
    nom = f"transcription-ticket-{info.get('num', 0):04d}.txt" if isinstance(info.get("num"), int) else "transcription.txt"

    # salon de transcriptions, sinon salon du journal
    dest_id = t["transcriptions"] or B.db.g(g.id)["channels"]["journal"]
    dest = g.get_channel(dest_id) if dest_id else None
    auteur = g.get_member(info["user"]) if info.get("user") else None
    if dest:
        e = discord.Embed(title=f"🎫 Ticket n°{info.get('num', '?')} fermé", color=COLOR, timestamp=discord.utils.utcnow(),
                          description=f"Ouvert par : {auteur.mention if auteur else info.get('user', 'inconnu')}\nFermé par : {par.mention}")
        try:
            await dest.send(embed=e, file=discord.File(io.BytesIO(data), filename=nom))
        except discord.HTTPException:
            pass
    if auteur:
        try:
            await auteur.send(f"Ton ticket sur **{g.name}** est fermé. Voici la transcription.",
                              file=discord.File(io.BytesIO(data), filename=nom))
        except discord.HTTPException:
            pass  # messages privés fermés : tant pis

    t["ouverts"].pop(str(ch.id), None)
    B.db.save()
    try:
        await ch.send("🔒 Ticket fermé. Ce salon sera supprimé dans 5 secondes.")
    except discord.HTTPException:
        pass
    await asyncio.sleep(5)
    try:
        await ch.delete(reason=f"NOLVA : ticket fermé par {par}")
    except discord.HTTPException:
        pass
    en_fermeture.discard(ch.id)


# ---------- Boutons (persistants : ils marchent même après un redémarrage) ----------
class FermerView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Fermer le ticket", emoji="🔒", style=discord.ButtonStyle.danger, custom_id="nolva:ticket:fermer")
    async def fermer(self, i: discord.Interaction, button: discord.ui.Button):
        t = cfg(i.guild.id)
        info = t["ouverts"].get(str(i.channel.id))
        if not info:
            return await i.response.send_message("Ce salon n’est pas un ticket suivi par NOLVA.", ephemeral=True)
        if i.user.id != info["user"] and not est_staff(i.user, t):
            return await i.response.send_message("Seul l’auteur du ticket ou l’équipe peut le fermer.", ephemeral=True)
        await i.response.send_message("🔒 Création de la transcription…")
        await fermer_ticket(i.channel, i.user)


class OuvrirView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Ouvrir un ticket", emoji="🎫", style=discord.ButtonStyle.primary, custom_id="nolva:ticket:ouvrir")
    async def ouvrir(self, i: discord.Interaction, button: discord.ui.Button):
        g, t = i.guild, cfg(i.guild.id)
        if not premium.actif(g.id):
            return await i.response.send_message(premium.MSG, ephemeral=True)
        for cid, info in list(t["ouverts"].items()):
            if info["user"] == i.user.id:
                ch = g.get_channel(int(cid))
                if ch:
                    return await i.response.send_message(f"Tu as déjà un ticket ouvert : {ch.mention}", ephemeral=True)
                del t["ouverts"][cid]
        await i.response.defer(ephemeral=True)

        cat = g.get_channel(t["categorie"]) if t["categorie"] else None
        staff = g.get_role(t["role_staff"]) if t["role_staff"] else None
        t["compteur"] += 1
        num = t["compteur"]
        droits = dict(view_channel=True, send_messages=True, read_message_history=True, attach_files=True, embed_links=True)
        ow = {
            g.default_role: discord.PermissionOverwrite(view_channel=False),
            i.user: discord.PermissionOverwrite(**droits),
            g.me: discord.PermissionOverwrite(manage_channels=True, **droits),
        }
        if staff:
            ow[staff] = discord.PermissionOverwrite(manage_messages=True, **droits)
        try:
            ch = await g.create_text_channel(f"ticket-{num:04d}", category=cat, overwrites=ow,
                                             topic=f"Ticket de {i.user} ({i.user.id})", reason=f"NOLVA : ticket de {i.user}")
        except discord.HTTPException:
            t["compteur"] -= 1
            return await i.followup.send("Je n’ai pas pu créer le salon. Vérifie que NOLVA a la permission « Gérer les salons » (réinvite-le avec le nouveau lien).", ephemeral=True)

        t["ouverts"][str(ch.id)] = {"user": i.user.id, "num": num, "date": int(discord.utils.utcnow().timestamp())}
        B.db.save()
        e = discord.Embed(title=f"Ticket n°{num}", color=COLOR,
                          description="Explique ta demande, l’équipe te répondra ici.\nQuand c’est réglé, appuie sur **Fermer le ticket**.")
        await ch.send(f"{i.user.mention}" + (f" {staff.mention}" if staff else ""), embed=e, view=FermerView(),
                      allowed_mentions=discord.AllowedMentions(users=True, roles=True))
        await i.followup.send(f"🎫 Ton ticket est ouvert : {ch.mention}", ephemeral=True)
        await B.log(g, f"🎫 {i.user.mention} a ouvert le ticket {ch.mention} (n°{num}).")


# ---------- Commandes /ticket ----------
grp = app_commands.Group(name="ticket", description="Système de tickets", guild_only=True)
ADMIN = app_commands.checks.has_permissions(manage_guild=True)


@grp.command(name="config", description="Régler les tickets (catégorie, équipe, transcriptions)")
@ADMIN
async def config(i: discord.Interaction, categorie: discord.CategoryChannel = None,
                 equipe: discord.Role = None, transcriptions: discord.TextChannel = None):
    t = cfg(i.guild.id)
    if categorie:
        t["categorie"] = categorie.id
    if equipe:
        t["role_staff"] = equipe.id
    if transcriptions:
        t["transcriptions"] = transcriptions.id
    B.db.save()
    cat = f"**{i.guild.get_channel(t['categorie']).name}**" if t["categorie"] and i.guild.get_channel(t["categorie"]) else "aucune (en haut du serveur)"
    await i.response.send_message(
        f"**Réglages des tickets**\nCatégorie : {cat}\n"
        f"Équipe : {'<@&%s>' % t['role_staff'] if t['role_staff'] else 'aucune (seuls les admins voient les tickets)'}\n"
        f"Transcriptions : {'<#%s>' % t['transcriptions'] if t['transcriptions'] else 'salon du journal'}",
        ephemeral=True, allowed_mentions=discord.AllowedMentions.none())


@grp.command(name="panneau", description="Envoyer le message avec le bouton « Ouvrir un ticket »")
@ADMIN
@premium.requis
async def panneau(i: discord.Interaction, salon: discord.TextChannel = None,
                  titre: str = "Besoin d’aide ?",
                  texte: str = "Appuie sur le bouton ci-dessous pour ouvrir un ticket privé avec l’équipe."):
    salon = salon or i.channel
    e = discord.Embed(title=titre[:200], description=texte[:1500], color=COLOR)
    try:
        await salon.send(embed=e, view=OuvrirView())
    except discord.HTTPException:
        return await i.response.send_message("Je ne peux pas écrire dans ce salon.", ephemeral=True)
    await i.response.send_message(f"✅ Panneau envoyé dans {salon.mention}.", ephemeral=True)


@grp.command(name="fermer", description="Fermer le ticket actuel")
async def fermer(i: discord.Interaction):
    t = cfg(i.guild.id)
    info = t["ouverts"].get(str(i.channel.id))
    if not info:
        return await i.response.send_message("Ce salon n’est pas un ticket.", ephemeral=True)
    if i.user.id != info["user"] and not est_staff(i.user, t):
        return await i.response.send_message("Seul l’auteur du ticket ou l’équipe peut le fermer.", ephemeral=True)
    await i.response.send_message("🔒 Création de la transcription…")
    await fermer_ticket(i.channel, i.user)


async def _droit(i, membre, ajouter: bool):
    t = cfg(i.guild.id)
    if str(i.channel.id) not in t["ouverts"]:
        return await i.response.send_message("Ce salon n’est pas un ticket.", ephemeral=True)
    if not est_staff(i.user, t):
        return await i.response.send_message("Réservé à l’équipe.", ephemeral=True)
    if ajouter:
        await i.channel.set_permissions(membre, view_channel=True, send_messages=True, read_message_history=True, attach_files=True)
        await i.response.send_message(f"➕ {membre.mention} a été ajouté au ticket.")
    else:
        await i.channel.set_permissions(membre, overwrite=None)
        await i.response.send_message(f"➖ {membre.mention} a été retiré du ticket.")


@grp.command(name="ajouter", description="Ajouter un membre au ticket")
async def ajouter(i: discord.Interaction, membre: discord.Member):
    await _droit(i, membre, True)


@grp.command(name="retirer", description="Retirer un membre du ticket")
async def retirer(i: discord.Interaction, membre: discord.Member):
    await _droit(i, membre, False)


async def on_channel_delete(ch):
    """Si un salon-ticket est supprimé à la main, on l'oublie."""
    if isinstance(ch, discord.TextChannel):
        t = cfg(ch.guild.id)
        if t["ouverts"].pop(str(ch.id), None) is not None:
            B.db.save()


async def setup(bot):
    global B
    B = bot
    bot.add_view(OuvrirView())
    bot.add_view(FermerView())
    bot.tree.add_command(grp)
    bot.add_listener(on_channel_delete, "on_guild_channel_delete")

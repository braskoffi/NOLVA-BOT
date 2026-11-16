"""NOLVA : assistant de création de serveur (/genese).

Le bot pose ses questions (type de serveur, nom, couleur, style, règlement, options), puis, après une
confirmation écrite, il SUPPRIME toute l'ancienne structure (salons, catégories, rôles) et construit la nouvelle.
Une sauvegarde JSON de l'ancien serveur est faite juste avant, pour pouvoir tout remettre avec /genese restaurer.

Sécurité : réservé au propriétaire du serveur, Premium requis, confirmation par mot à taper, un seul lancement à la fois.
"""
import asyncio
import io
import json

import discord
from discord import app_commands

import premium

B = None  # le bot, rempli dans setup()
COLOR = 0x7CF0D0
EN_COURS = set()  # serveurs en cours de reconstruction
MAX_SALONS, MAX_ROLES, MAX_CATS = 450, 240, 90

PERMS_MODO = discord.Permissions(kick_members=True, ban_members=True, moderate_members=True, manage_messages=True,
                                 view_audit_log=True).value
PERMS_ADMIN = PERMS_MODO | discord.Permissions(manage_channels=True, manage_roles=True, mention_everyone=True).value

# ---------------------------------------------------------------- Gabarits
# (emoji, nom, sujet) pour les salons ; (emoji, titre, [salons]) pour les catégories
GABARITS = {
    "communaute": {
        "nom": "Communauté", "emoji": "🌍", "couleur": 0x3B82F6, "desc": "Discussions, médias, mèmes, présentations",
        "cats": [("💬", "communauté", [("💬", "général", "Discute de tout et de rien"),
                                      ("🙋", "présentations", "Présente-toi à la communauté"),
                                      ("📸", "médias", "Photos, vidéos, créations"),
                                      ("😂", "mèmes", "Les meilleurs mèmes"),
                                      ("🤖", "commandes-bot", "Les commandes des bots, ici")]),
                 ("🎉", "loisirs", [("🎮", "jeux", "Parlons jeux vidéo"), ("🎵", "musique", "Partage tes sons"),
                                   ("🎬", "films-séries", "Films et séries")])],
        "roles": [("💎", "Fidèle", 0x9B59B6)],
        "vocaux": [("🔊", "Général"), ("🎵", "Musique"), ("☕", "Chill")]},
    "gaming": {
        "nom": "Gaming", "emoji": "🎮", "couleur": 0x8B5CF6, "desc": "Équipes, clips, tournois, vocaux de jeu",
        "cats": [("🎮", "gaming", [("💬", "général-gaming", "Parle de tes jeux préférés"),
                                  ("🤝", "recherche-équipe", "Trouve des coéquipiers"),
                                  ("🎬", "clips", "Tes meilleures actions"),
                                  ("🖥️", "setups", "Montre ton setup")]),
                 ("🏆", "compétition", [("📅", "tournois", "Annonces et inscriptions"),
                                       ("📈", "classements", "Les scores et rangs")])],
        "roles": [("🏆", "Compétitif", 0xF1C40F), ("🎮", "Joueur", 0x2ECC71)],
        "vocaux": [("🎧", "Lobby 1"), ("🎧", "Lobby 2"), ("🎧", "Lobby 3"), ("🏆", "Ranked"), ("😴", "AFK")]},
    "boutique": {
        "nom": "Boutique", "emoji": "🛒", "couleur": 0x10B981, "desc": "Catalogue, avis clients, commandes, FAQ",
        "cats": [("🛒", "boutique", [("📦", "catalogue", "Tous les produits"), ("🔥", "promotions", "Offres du moment"),
                                    ("⭐", "avis-clients", "Les retours de nos clients"),
                                    ("🧾", "commandes", "Suivi des commandes")]),
                 ("❓", "aide", [("📖", "faq", "Questions fréquentes"), ("💬", "questions", "Pose tes questions")])],
        "roles": [("🛍️", "Vendeur", 0x1ABC9C), ("💎", "Client", 0xF1C40F)],
        "vocaux": [("🔊", "Vocal clients"), ("🔊", "Vocal équipe")]},
    "createur": {
        "nom": "Créateur", "emoji": "🎥", "couleur": 0xEC4899, "desc": "Lives, clips, fan-art, idées de contenu",
        "cats": [("🎥", "créateur", [("🔴", "annonces-lives", "Les lives à venir"), ("🎬", "clips", "Les meilleurs moments"),
                                    ("🎨", "fan-art", "Les créations de la communauté"),
                                    ("💡", "idées-contenu", "Propose ce que je dois faire")]),
                 ("💬", "communauté", [("💬", "discussion", "Discute avec les autres fans"),
                                      ("😂", "mèmes", "Pour rire un peu")])],
        "roles": [("⭐", "VIP", 0xF1C40F), ("💜", "Abonné", 0x9B59B6)],
        "vocaux": [("🔴", "Live"), ("☕", "Chill"), ("🎙️", "Studio")]},
    "etudes": {
        "nom": "Études", "emoji": "📚", "couleur": 0x0EA5E9, "desc": "Cours, aide aux devoirs, organisation",
        "cats": [("📚", "cours", [("➗", "maths", "Maths et logique"), ("🔬", "sciences", "Physique, chimie, SVT"),
                                 ("🌐", "langues", "Langues vivantes"), ("💻", "informatique", "Code et technologie"),
                                 ("🆘", "aide-devoirs", "Demande de l'aide")]),
                 ("🗓️", "organisation", [("📅", "planning", "Examens et échéances"),
                                        ("🎯", "objectifs", "Tes objectifs de la semaine"),
                                        ("📎", "ressources", "Cours, fiches, liens utiles")])],
        "roles": [("🎓", "Tuteur", 0xF39C12)],
        "vocaux": [("📖", "Salle d'étude 1"), ("📖", "Salle d'étude 2"), ("☕", "Pause")]},
    "projet": {
        "nom": "Projet / Support", "emoji": "🛠️", "couleur": 0x6366F1, "desc": "Changelog, bugs, suggestions, aide",
        "cats": [("🛠️", "projet", [("📝", "changelog", "Les nouveautés"), ("🗺️", "roadmap", "Ce qui arrive"),
                                  ("🐞", "bugs", "Signale un bug"), ("💡", "idées", "Propose une fonctionnalité")]),
                 ("🙋", "aide", [("💬", "aide-utilisateurs", "Pose tes questions"), ("📖", "faq", "Réponses rapides")])],
        "roles": [("🧪", "Bêta-testeur", 0x2ECC71), ("🛠️", "Contributeur", 0x3498DB)],
        "vocaux": [("🔊", "Aide vocale"), ("🔊", "Réunion")]},
    "minimal": {
        "nom": "Minimaliste", "emoji": "✨", "couleur": 0x64748B, "desc": "Le strict nécessaire, propre et simple",
        "cats": [("💬", "serveur", [("💬", "général", "Discussion générale"), ("📸", "médias", "Images et vidéos")])],
        "roles": [], "vocaux": [("🔊", "Vocal")]},
}

OPTIONS = {
    "regles": ("📜", "Règlement", "Salon règlement avec les règles"),
    "bienvenue": ("👋", "Bienvenue automatique", "Salon + message d'arrivée + rôle Membre auto"),
    "annonces": ("📢", "Annonces et sondages", "Salons en lecture seule pour le staff"),
    "suggestions": ("💡", "Suggestions", "Un salon pour les idées des membres"),
    "vocaux": ("🔊", "Salons vocaux", "Catégorie vocale adaptée au type de serveur"),
    "staff": ("🛡️", "Zone staff + journal", "Salons privés, journal des actions branché"),
    "tickets": ("🎫", "Tickets de support", "Panneau prêt, transcriptions dans la zone staff"),
    "protection": ("🚨", "Protection", "Anti-raid et anti-spam activés"),
}
OPT_DEFAUT = ("regles", "bienvenue", "vocaux", "staff", "protection")

REGLES_DEFAUT = ("1️⃣ **Respect** : pas d'insultes, de harcèlement ni de discrimination.\n"
                 "2️⃣ **Pas de spam** ni de publicité sans l'accord du staff.\n"
                 "3️⃣ **Contenu** : rien d'illégal, de choquant ou de piraté.\n"
                 "4️⃣ **Bon salon** : garde chaque discussion à sa place.\n"
                 "5️⃣ **Staff** : écoute l'équipe. Un souci ? Contacte un modérateur.")


# ---------------------------------------------------------------- Plan (gabarit + options -> structure)
def deco_cat(emoji, titre, style):
    if style == "simple":
        return titre.upper()
    if style == "ligne":
        return f"━ {titre.upper()} ━"
    return f"{emoji} {titre.upper()}"


def deco_salon(emoji, nom, style, vocal=False):
    if style == "simple":
        return nom
    if style == "ligne":
        return f"┃{nom}"
    return f"{emoji}・{nom}"


def S(cle, emoji, nom, style, sujet="", ro=False, vocal=False):
    return {"cle": cle, "nom": deco_salon(emoji, nom, style, vocal), "type": "vocal" if vocal else "texte",
            "sujet": sujet, "ro": ro}


def planifier(gab, opts, style="emoji", couleur=None, nom=None, regles=None):
    """Transforme un gabarit et des options en structure complète (rôles, catégories, salons)."""
    g, opts = GABARITS[gab], set(opts)
    if "tickets" in opts:
        opts.add("staff")  # les transcriptions ont besoin de la zone staff
    emo = style == "emoji"
    roles = [{"cle": "admin", "nom": "Admin", "couleur": 0xE74C3C, "hoist": True, "perms": PERMS_ADMIN},
             {"cle": "modo", "nom": "Modérateur", "couleur": 0xE67E22, "hoist": True, "perms": PERMS_MODO}]
    for e, n, c in g["roles"]:
        roles.append({"cle": None, "nom": f"{e} {n}" if emo else n, "couleur": c, "hoist": False, "perms": None})
    roles.append({"cle": "membre", "nom": "Membre", "couleur": couleur if couleur is not None else g["couleur"],
                  "hoist": False, "perms": None})

    cats = []
    info = []
    if "regles" in opts:
        info.append(S("regles", "📜", "règlement", style, "Les règles à respecter", ro=True))
    if "bienvenue" in opts:
        info.append(S("bienvenue", "👋", "bienvenue", style, "Bienvenue aux nouveaux membres", ro=True))
    if "annonces" in opts:
        info.append(S("annonces", "📢", "annonces", style, "Les annonces officielles", ro=True))
        info.append(S("sondages", "📊", "sondages", style, "Les sondages du serveur", ro=True))
    if info:
        cats.append({"nom": deco_cat("📌", "informations", style), "zone": "public", "salons": info})
    for k, (e, t, salons) in enumerate(g["cats"]):
        sal = [S(None, se, sn, style, ss) for se, sn, ss in salons]
        if k == 0 and "suggestions" in opts:
            sal.append(S("suggestions", "💡", "suggestions", style, "Propose tes idées"))
        cats.append({"nom": deco_cat(e, t, style), "zone": "public", "salons": sal})
    if "vocaux" in opts and g["vocaux"]:
        cats.append({"nom": deco_cat("🔊", "vocal", style), "zone": "public",
                     "salons": [S(None, ve, vn, style, vocal=True) for ve, vn in g["vocaux"]]})
    if "tickets" in opts:
        cats.append({"nom": deco_cat("🎫", "support", style), "zone": "public", "cle": "tickets_cat",
                     "salons": [S("tickets", "🎫", "ouvrir-un-ticket", style, "Ouvre un ticket privé avec l'équipe", ro=True)]})
    if "staff" in opts:
        sal = [S("journal", "🧾", "journal", style, "Journal des actions de NOLVA"),
               S(None, "💬", "discussion-staff", style, "Réservé à l'équipe"),
               S(None, "🤖", "commandes-staff", style, "Commandes de modération")]
        if "tickets" in opts:
            sal.append(S("transcriptions", "📄", "transcriptions", style, "Transcriptions des tickets fermés"))
        sal.append(S(None, "🔒", "vocal-staff", style, vocal=True))
        cats.append({"nom": deco_cat("🛡️", "staff", style), "zone": "staff", "salons": sal})

    return {"gabarit": gab, "nom": (nom or "").strip()[:100] or None, "roles": roles, "categories": cats,
            "regles_texte": (regles or "").strip()[:1500] or REGLES_DEFAUT, "protection": "protection" in opts,
            "ticket_panel": "tickets" in opts}


def apercu(spec) -> str:
    lignes = ["**Rôles** : " + ", ".join(r["nom"] for r in spec["roles"]), ""]
    for c in spec["categories"]:
        lignes.append(f"**{c['nom'] or '(sans catégorie)'}**" + ("  🔒 privée" if c.get("zone") == "staff" else ""))
        for s in c["salons"]:
            icone = "🔊" if s["type"] == "vocal" else ("📢" if s.get("ro") else "#")
            lignes.append(f"  {icone} {s['nom']}")
    texte = "\n".join(lignes)
    return texte if len(texte) < 3900 else texte[:3890] + "\n…"


# ---------------------------------------------------------------- Sauvegarde / restauration (JSON)
def exporter(guild: discord.Guild) -> bytes:
    roles = [{"nom": r.name[:100], "couleur": r.colour.value, "hoist": r.hoist, "perms": r.permissions.value}
             for r in sorted(guild.roles, key=lambda r: -r.position) if not r.is_default() and not r.managed]

    def ow(ch):
        out = []
        for cible, o in ch.overwrites.items():
            if isinstance(cible, discord.Role):
                a, d = o.pair()
                out.append({"role": "@everyone" if cible.is_default() else cible.name, "allow": a.value, "deny": d.value})
        return out

    def salon(ch):
        vocal = isinstance(ch, (discord.VoiceChannel, discord.StageChannel))
        s = {"nom": ch.name, "type": "vocal" if vocal else "texte", "ow": ow(ch)}
        if vocal:
            s["limite"] = getattr(ch, "user_limit", 0) or 0
        else:
            s.update(sujet=getattr(ch, "topic", None) or "", nsfw=bool(getattr(ch, "nsfw", False)),
                     lent=getattr(ch, "slowmode_delay", 0) or 0)
        return s

    cats = []
    libres = [c for c in guild.channels if not isinstance(c, discord.CategoryChannel) and c.category is None
              and isinstance(c, (discord.TextChannel, discord.VoiceChannel, discord.StageChannel, discord.ForumChannel))]
    if libres:
        cats.append({"nom": None, "ow": None, "salons": [salon(c) for c in sorted(libres, key=lambda c: c.position)]})
    for cat in guild.categories:
        cats.append({"nom": cat.name, "ow": ow(cat),
                     "salons": [salon(c) for c in cat.channels
                                if isinstance(c, (discord.TextChannel, discord.VoiceChannel, discord.StageChannel,
                                                  discord.ForumChannel))]})
    data = {"nolva_sauvegarde": 1, "serveur": guild.name, "date": discord.utils.utcnow().isoformat(),
            "roles": roles, "categories": cats}
    return json.dumps(data, ensure_ascii=False, indent=1).encode("utf-8")


def _txt(v, n=100, defaut=""):
    return v[:n] if isinstance(v, str) and v else defaut


def _int(v, lo, hi, defaut=0):
    if isinstance(v, bool) or not isinstance(v, int):
        return defaut
    return max(lo, min(hi, v))


def valider(data):
    """Nettoie un fichier de sauvegarde. Renvoie une structure sûre, ou None si le fichier n'est pas valable."""
    if not isinstance(data, dict) or data.get("nolva_sauvegarde") != 1:
        return None
    roles, cats, total = [], [], 0
    for r in (data.get("roles") or [])[:MAX_ROLES]:
        if isinstance(r, dict) and _txt(r.get("nom")):
            roles.append({"cle": None, "nom": _txt(r["nom"]), "couleur": _int(r.get("couleur"), 0, 0xFFFFFF),
                          "hoist": bool(r.get("hoist")), "perms": _int(r.get("perms"), 0, (1 << 50) - 1)})

    def ows(lst):
        if lst is None:
            return None
        return [{"role": _txt(o.get("role")), "allow": _int(o.get("allow"), 0, (1 << 50) - 1),
                 "deny": _int(o.get("deny"), 0, (1 << 50) - 1)} for o in lst[:50] if isinstance(o, dict)]

    for c in (data.get("categories") or [])[:MAX_CATS]:
        if not isinstance(c, dict):
            continue
        sal = []
        for s in (c.get("salons") or []):
            if total >= MAX_SALONS:
                break
            if isinstance(s, dict) and _txt(s.get("nom")):
                sal.append({"cle": None, "nom": _txt(s["nom"]), "type": "vocal" if s.get("type") == "vocal" else "texte",
                            "sujet": _txt(s.get("sujet"), 1024), "nsfw": bool(s.get("nsfw")),
                            "lent": _int(s.get("lent"), 0, 21600), "limite": _int(s.get("limite"), 0, 99),
                            "ow": ows(s.get("ow")), "ro": False})
                total += 1
        nom = _txt(c.get("nom")) or None
        if sal or nom:
            cats.append({"nom": nom, "zone": "public", "ow": ows(c.get("ow")), "salons": sal})
    if not roles and not cats:
        return None
    return {"gabarit": None, "nom": None, "roles": roles, "categories": cats, "regles_texte": None,
            "protection": False, "ticket_panel": False, "restauration": True}


# ---------------------------------------------------------------- Construction
def calculer_ow(guild, zone, ro, ow_spec, rc, rn):
    """Permissions d'un salon ou d'une catégorie. Renvoie None s'il n'y a rien de particulier."""
    me = guild.me.guild_permissions
    if ow_spec is not None:
        res = {}
        for o in ow_spec:
            role = guild.default_role if o["role"] == "@everyone" else rn.get(o["role"])
            if role:
                res[role] = discord.PermissionOverwrite.from_pair(discord.Permissions(o["allow"] & me.value),
                                                                  discord.Permissions(o["deny"]))
        return res or None
    c = {}

    def add(cible, **kw):
        if cible is not None:
            c.setdefault(cible, {}).update(kw)

    if zone == "staff":
        add(guild.default_role, view_channel=False)
        for k in ("admin", "modo"):
            add(rc.get(k), view_channel=True, send_messages=True)
    if ro:
        add(guild.default_role, send_messages=False)
        for k in ("admin", "modo"):
            add(rc.get(k), send_messages=True)
    if c:
        add(guild.me, view_channel=True, send_messages=True, manage_channels=True, embed_links=True,
            attach_files=True, read_message_history=True)
    # on ne peut accorder que les permissions qu'on a soi-même
    return {k: discord.PermissionOverwrite(**{p: v for p, v in kw.items() if not v or getattr(me, p)})
            for k, kw in c.items()} or None


async def effacer_tout(guild, garde, maj):
    """Supprime tous les salons (sauf celui où tourne la commande), puis tous les rôles que NOLVA peut supprimer."""
    sem, echecs = asyncio.Semaphore(3), []

    async def sup(obj):
        async with sem:
            try:
                await obj.delete(reason="NOLVA : reconstruction du serveur")
            except discord.HTTPException:
                echecs.append(obj.name)

    salons = [c for c in guild.channels if c.id != garde.id]
    await maj(f"🗑️ Suppression de {len(salons)} salon(s) et catégorie(s)…")
    await asyncio.gather(*(sup(c) for c in salons))
    roles = [r for r in guild.roles if not r.is_default() and not r.managed and r < guild.me.top_role]
    await maj(f"🗑️ Suppression de {len(roles)} rôle(s)…")
    await asyncio.gather(*(sup(r) for r in roles))
    return len(salons), len(roles), echecs


def reinitialiser_reglages(gid):
    """L'ancien serveur n'existe plus : on efface aussi ses réglages NOLVA (salons, menus, tickets, automatisations)."""
    import tickets
    c = B.db.g(gid)
    c["channels"] = {"journal": None, "bienvenue": None}
    c["autorole"] = None
    c["features"] = {k: False for k in c["features"]}
    c["roles"] = {"menus": {}, "reactions": {}}
    c["automations"] = []
    t = tickets.cfg(gid)
    t.update(categorie=None, role_staff=None, transcriptions=None, ouverts={})
    B.db.save()


async def construire(guild, spec, maj):
    me = guild.me.guild_permissions
    rc, rn, cles, notes = {}, {}, {}, []
    nb_roles = nb_salons = 0
    for r in spec["roles"]:
        try:
            role = await guild.create_role(name=r["nom"], colour=discord.Colour(r["couleur"]), hoist=r["hoist"],
                                           permissions=discord.Permissions((r["perms"] or 0) & me.value),
                                           reason="NOLVA : reconstruction du serveur")
        except discord.HTTPException:
            notes.append(f"Rôle non créé : {r['nom']}")
            continue
        nb_roles += 1
        if r.get("cle"):
            rc[r["cle"]] = role
        rn.setdefault(r["nom"], role)
    total = sum(len(c["salons"]) for c in spec["categories"])
    for c in spec["categories"]:
        cat = None
        if c.get("nom"):
            ow = calculer_ow(guild, c.get("zone"), False, c.get("ow"), rc, rn) if (c.get("zone") == "staff" or c.get("ow") is not None) else None
            try:
                cat = await guild.create_category(c["nom"], reason="NOLVA : reconstruction du serveur",
                                                  **({"overwrites": ow} if ow else {}))
            except discord.HTTPException:
                notes.append(f"Catégorie non créée : {c['nom']}")
                continue
            if c.get("cle"):
                cles[c["cle"]] = cat
        for s in c["salons"]:
            ow_spec = s.get("ow")
            zone = c.get("zone")
            if ow_spec is None and zone == "staff" and not s.get("ro"):
                ow = None  # hérite de la catégorie privée
            else:
                ow = calculer_ow(guild, zone, s.get("ro"), ow_spec, rc, rn)
            kw = {"overwrites": ow} if ow else {}
            try:
                if s["type"] == "vocal":
                    ch = await guild.create_voice_channel(s["nom"], category=cat, user_limit=s.get("limite", 0),
                                                          reason="NOLVA : reconstruction du serveur", **kw)
                else:
                    ch = await guild.create_text_channel(s["nom"], category=cat, topic=s.get("sujet") or None,
                                                         slowmode_delay=s.get("lent", 0), nsfw=s.get("nsfw", False),
                                                         reason="NOLVA : reconstruction du serveur", **kw)
            except discord.HTTPException:
                notes.append(f"Salon non créé : {s['nom']}")
                continue
            nb_salons += 1
            if s.get("cle"):
                cles[s["cle"]] = ch
            if nb_salons % 6 == 0:
                await maj(f"🏗️ Construction… {nb_salons}/{total} salons")
    return rc, cles, nb_roles, nb_salons, notes


async def finaliser(guild, spec, rc, cles):
    """Branche les fonctions de NOLVA sur les nouveaux salons et publie les messages de départ."""
    import tickets
    c = B.db.g(guild.id)
    if cles.get("bienvenue"):
        c["channels"]["bienvenue"] = cles["bienvenue"].id
        c["features"]["bienvenue"] = True
        if rc.get("membre"):
            c["autorole"] = rc["membre"].id
            c["features"]["autorole"] = True
    if cles.get("journal"):
        c["channels"]["journal"] = cles["journal"].id
        c["features"]["journal"] = True
    if spec.get("protection"):
        c["features"]["antiraid"] = c["features"]["antispam"] = True
    if spec.get("ticket_panel") and cles.get("tickets"):
        t = tickets.cfg(guild.id)
        t["categorie"] = cles["tickets_cat"].id if cles.get("tickets_cat") else None
        t["role_staff"] = rc["modo"].id if rc.get("modo") else None
        t["transcriptions"] = cles["transcriptions"].id if cles.get("transcriptions") else None
    B.db.save()
    try:
        if cles.get("regles"):
            await cles["regles"].send(embed=discord.Embed(title="📜 Règlement", description=spec["regles_texte"], color=COLOR))
        if spec.get("ticket_panel") and cles.get("tickets"):
            await cles["tickets"].send(embed=discord.Embed(
                title="Besoin d'aide ?", color=COLOR,
                description="Appuie sur le bouton ci-dessous pour ouvrir un ticket privé avec l'équipe."),
                view=tickets.OuvrirView())
    except discord.HTTPException:
        pass


async def executer(i: discord.Interaction, spec, garde, auteur):
    """Sauvegarde -> suppression totale -> construction -> branchement -> rapport."""
    guild = i.guild
    if guild.id in EN_COURS:
        return await i.response.edit_message(content="Une reconstruction est déjà en cours sur ce serveur.", embed=None, view=None)
    EN_COURS.add(guild.id)
    await i.response.edit_message(content="⏳ Sauvegarde de l'ancien serveur…", embed=None, view=None)

    async def maj(txt):
        try:
            await i.edit_original_response(content=txt)
        except discord.HTTPException:
            pass

    try:
        sauvegarde = exporter(guild)
        n_salons, n_roles, echecs = await effacer_tout(guild, garde, maj)
        reinitialiser_reglages(guild.id)
        notes = []
        if spec.get("nom") and spec["nom"] != guild.name:
            try:
                await guild.edit(name=spec["nom"], reason="NOLVA : reconstruction du serveur")
            except discord.HTTPException:
                notes.append(f"Je n'ai pas pu renommer le serveur en « {spec['nom']} » (permission « Gérer le serveur » manquante) : fais-le dans les paramètres.")
        rc, cles, nb_roles, nb_salons, notes2 = await construire(guild, spec, maj)
        await maj("🔧 Branchement des fonctions de NOLVA…")
        await finaliser(guild, spec, rc, cles)
        if rc.get("admin") and isinstance(auteur, discord.Member):
            try:
                await auteur.add_roles(rc["admin"], reason="NOLVA : reconstruction du serveur")
            except discord.HTTPException:
                pass
        notes += notes2
        if echecs:
            notes.append("Non supprimés (protégés par Discord ou au-dessus de NOLVA) : " + ", ".join(echecs[:10])
                         + (" …" if len(echecs) > 10 else "") + ". Si le serveur est en mode Communauté, désactive-le pour les retirer.")
        e = discord.Embed(title="✅ Ton nouveau serveur est prêt", color=COLOR,
                          description=f"**{n_salons}** salon(s) et **{n_roles}** rôle(s) supprimés · "
                                      f"**{nb_salons}** salon(s) et **{nb_roles}** rôle(s) créés.")
        e.add_field(name="Sauvegarde", value="Le fichier `nolva-sauvegarde.json` contient l'ancien serveur. "
                    "Pour le remettre : `/genese restaurer`.", inline=False)
        e.add_field(name="À faire ensuite", value="Place le rôle **NOLVA** en haut de la liste des rôles, puis règle le reste dans le panneau.", inline=False)
        if notes:
            e.add_field(name="À savoir", value="\n".join("• " + n for n in notes)[:1000], inline=False)
        fichier = lambda: discord.File(io.BytesIO(sauvegarde), "nolva-sauvegarde.json")
        dest = cles.get("journal") or cles.get("bienvenue") or next(
            (ch for ch in guild.text_channels if ch.id != garde.id), None)
        if dest:
            try:
                await dest.send(embed=e, file=fichier())
            except discord.HTTPException:
                pass
        try:
            await auteur.send(content=f"Sauvegarde de **{guild.name}** avant la reconstruction :", file=fichier())
        except discord.HTTPException:
            pass
        try:
            await garde.delete(reason="NOLVA : reconstruction du serveur")  # le salon de la commande part en dernier
        except discord.HTTPException:
            pass
        await maj("✅ Terminé ! Ouvre ton nouveau serveur.")
        try:
            await i.followup.send(embed=e, file=fichier(), ephemeral=True)
        except discord.HTTPException:
            pass
        await B.log(guild, f"🏗️ {auteur.mention} a reconstruit le serveur avec /genese.")
    except Exception as ex:
        print("Erreur /genese :", repr(ex))
        await maj("❌ La reconstruction s'est arrêtée sur une erreur. Vérifie les permissions de NOLVA et relance. "
                  "Une sauvegarde de l'ancien serveur a été faite au début.")
    finally:
        EN_COURS.discard(guild.id)


# ---------------------------------------------------------------- Interface
def garde_salon(i):
    ch = i.channel
    return ch.parent if isinstance(ch, discord.Thread) else ch


class Confirmation(discord.ui.Modal, title="Dernière confirmation"):
    def __init__(self, spec, garde, auteur):
        super().__init__()
        self.spec, self.garde, self.auteur = spec, garde, auteur
        self.mot = discord.ui.TextInput(label="Écris SUPPRIMER pour tout effacer", max_length=20)
        self.add_item(self.mot)

    async def on_submit(self, i: discord.Interaction):
        if i.user.id != i.guild.owner_id:
            return await i.response.send_message("Réservé au propriétaire du serveur.", ephemeral=True)
        if self.mot.value.strip().upper() != "SUPPRIMER":
            return await i.response.edit_message(content="Annulé : le mot de confirmation n'était pas correct. Rien n'a été supprimé.",
                                                 embed=None, view=None)
        await executer(i, self.spec, self.garde, self.auteur)


class Details(discord.ui.Modal, title="Détails du nouveau serveur"):
    def __init__(self, vue):
        super().__init__()
        self.vue = vue
        self.f_nom = discord.ui.TextInput(label="Nom du serveur (vide = garder l'actuel)", required=False,
                                          max_length=100, default=vue.nom)
        self.f_couleur = discord.ui.TextInput(label="Couleur du rôle Membre (ex. #3B82F6)", required=False, max_length=7,
                                              default=f"#{vue.couleur:06X}" if vue.couleur is not None else None)
        self.f_style = discord.ui.TextInput(label="Style des noms : emoji, simple ou ligne", required=False,
                                            max_length=10, default=vue.style)
        self.f_regles = discord.ui.TextInput(label="Règlement (vide = règlement par défaut)", required=False,
                                             style=discord.TextStyle.paragraph, max_length=1500, default=vue.regles)
        for champ in (self.f_nom, self.f_couleur, self.f_style, self.f_regles):
            self.add_item(champ)

    async def on_submit(self, i: discord.Interaction):
        v = self.vue
        c = self.f_couleur.value.strip().lstrip("#")
        v.couleur = None
        if len(c) == 6:
            try:
                v.couleur = int(c, 16)
            except ValueError:
                pass
        v.nom = self.f_nom.value.strip() or None
        st = self.f_style.value.strip().lower()
        v.style = st if st in ("emoji", "simple", "ligne") else "emoji"
        v.regles = self.f_regles.value.strip() or None
        await i.response.edit_message(embed=v.embed(), view=v)


class Assistant(discord.ui.View):
    """L'assistant : le bot pose ses questions, tu réponds avec les menus et les boutons."""

    def __init__(self, user_id):
        super().__init__(timeout=900)
        self.user_id = user_id
        self.gab, self.opts = None, set(OPT_DEFAUT)
        self.nom = self.couleur = self.regles = None
        self.style = "emoji"
        s1 = discord.ui.Select(placeholder="1. Quel type de serveur ?", row=0, options=[
            discord.SelectOption(label=g["nom"], value=k, emoji=g["emoji"], description=g["desc"][:100])
            for k, g in GABARITS.items()])
        s1.callback = self.choisir_gabarit
        s2 = discord.ui.Select(placeholder="2. Quelles options ?", row=1, min_values=0, max_values=len(OPTIONS), options=[
            discord.SelectOption(label=n, value=k, emoji=e, description=d[:100], default=k in self.opts)
            for k, (e, n, d) in OPTIONS.items()])
        s2.callback = self.choisir_options
        self.s1, self.s2 = s1, s2
        self.add_item(s1)
        self.add_item(s2)

    async def interaction_check(self, i: discord.Interaction) -> bool:
        if i.user.id != self.user_id:
            await i.response.send_message("Cet assistant n'est pas pour toi.", ephemeral=True)
            return False
        return True

    def spec(self):
        return planifier(self.gab, self.opts, self.style, self.couleur, self.nom, self.regles)

    def embed(self):
        g = GABARITS.get(self.gab)
        e = discord.Embed(title="🏗️ Assistant de création de serveur", color=COLOR,
                          description="Choisis un type, coche les options, ajoute tes détails, puis lance.\n"
                                      "⚠️ **Tout l'ancien serveur (salons, catégories, rôles) sera supprimé.** "
                                      "Une sauvegarde est faite juste avant.")
        e.add_field(name="Type", value=f"{g['emoji']} {g['nom']}" if g else "— à choisir —")
        e.add_field(name="Options", value="\n".join(f"{OPTIONS[k][0]} {OPTIONS[k][1]}" for k in OPTIONS if k in self.opts) or "Aucune")
        e.add_field(name="Détails", value=f"Nom : {self.nom or 'inchangé'}\nStyle : {self.style}\n"
                    f"Couleur : {'#%06X' % self.couleur if self.couleur is not None else 'par défaut'}\n"
                    f"Règlement : {'personnalisé' if self.regles else 'par défaut'}", inline=False)
        return e

    async def choisir_gabarit(self, i: discord.Interaction):
        self.gab = self.s1.values[0]
        for o in self.s1.options:
            o.default = o.value == self.gab
        await i.response.edit_message(embed=self.embed(), view=self)

    async def choisir_options(self, i: discord.Interaction):
        self.opts = set(self.s2.values)
        for o in self.s2.options:
            o.default = o.value in self.opts
        await i.response.edit_message(embed=self.embed(), view=self)

    @discord.ui.button(label="Détails", emoji="✏️", style=discord.ButtonStyle.secondary, row=2)
    async def details(self, i: discord.Interaction, b: discord.ui.Button):
        await i.response.send_modal(Details(self))

    @discord.ui.button(label="Aperçu", emoji="👁️", style=discord.ButtonStyle.secondary, row=2)
    async def voir(self, i: discord.Interaction, b: discord.ui.Button):
        if not self.gab:
            return await i.response.send_message("Choisis d'abord un type de serveur.", ephemeral=True)
        await i.response.send_message(embed=discord.Embed(title="Aperçu du nouveau serveur", color=COLOR,
                                                          description=apercu(self.spec())), ephemeral=True)

    @discord.ui.button(label="Lancer", emoji="🚀", style=discord.ButtonStyle.danger, row=2)
    async def lancer(self, i: discord.Interaction, b: discord.ui.Button):
        if not self.gab:
            return await i.response.send_message("Choisis d'abord un type de serveur.", ephemeral=True)
        await i.response.send_modal(Confirmation(self.spec(), garde_salon(i), i.user))

    @discord.ui.button(label="Annuler", style=discord.ButtonStyle.secondary, row=2)
    async def annuler(self, i: discord.Interaction, b: discord.ui.Button):
        self.stop()
        await i.response.edit_message(content="Annulé. Rien n'a été supprimé.", embed=None, view=None)


class BoutonRestaurer(discord.ui.View):
    def __init__(self, user_id, spec):
        super().__init__(timeout=300)
        self.user_id, self.spec = user_id, spec

    async def interaction_check(self, i: discord.Interaction) -> bool:
        return i.user.id == self.user_id

    @discord.ui.button(label="Tout effacer et restaurer", emoji="⚠️", style=discord.ButtonStyle.danger)
    async def go(self, i: discord.Interaction, b: discord.ui.Button):
        await i.response.send_modal(Confirmation(self.spec, garde_salon(i), i.user))


# ---------------------------------------------------------------- Commandes
grp = app_commands.Group(name="genese", description="Créer ou reconstruire tout le serveur", guild_only=True,
                         default_permissions=discord.Permissions(administrator=True))


def verifier(i: discord.Interaction):
    """Renvoie un message d'erreur si la reconstruction est impossible, sinon None."""
    if i.user.id != i.guild.owner_id:
        return "🔒 Seul le **propriétaire du serveur** peut tout reconstruire : c'est une action irréversible."
    p = i.guild.me.guild_permissions
    if not (p.manage_channels and p.manage_roles):
        return "Il me faut les permissions **Gérer les salons** et **Gérer les rôles** (réinvite NOLVA avec le lien du README)."
    if i.guild.id in EN_COURS:
        return "Une reconstruction est déjà en cours."
    return None


@grp.command(name="lancer", description="Assistant : supprime l'ancien serveur et en construit un nouveau")
@premium.requis
async def lancer(i: discord.Interaction):
    err = verifier(i)
    if err:
        return await i.response.send_message(err, ephemeral=True)
    v = Assistant(i.user.id)
    await i.response.send_message(embed=v.embed(), view=v, ephemeral=True)


@grp.command(name="sauvegarde", description="Télécharger une sauvegarde de la structure du serveur")
@premium.requis
@app_commands.checks.has_permissions(manage_guild=True)
async def sauvegarde(i: discord.Interaction):
    await i.response.send_message("💾 Sauvegarde de la structure (rôles, catégories, salons, permissions par rôle). "
                                  "Les messages et les membres ne sont pas inclus.",
                                  file=discord.File(io.BytesIO(exporter(i.guild)), "nolva-sauvegarde.json"), ephemeral=True)


@grp.command(name="restaurer", description="Remettre une sauvegarde (efface d'abord le serveur actuel)")
@premium.requis
async def restaurer(i: discord.Interaction, fichier: discord.Attachment):
    err = verifier(i)
    if err:
        return await i.response.send_message(err, ephemeral=True)
    if fichier.size > 1_000_000 or not fichier.filename.endswith(".json"):
        return await i.response.send_message("Envoie le fichier `nolva-sauvegarde.json` (moins de 1 Mo).", ephemeral=True)
    try:
        spec = valider(json.loads((await fichier.read()).decode("utf-8")))
    except (ValueError, UnicodeDecodeError):
        spec = None
    if not spec:
        return await i.response.send_message("Ce fichier n'est pas une sauvegarde NOLVA valable.", ephemeral=True)
    n = sum(len(c["salons"]) for c in spec["categories"])
    await i.response.send_message(
        f"Sauvegarde lue : **{len(spec['roles'])}** rôle(s), **{n}** salon(s).\n"
        "⚠️ Le serveur actuel sera **entièrement supprimé**, puis remplacé par cette sauvegarde.",
        view=BoutonRestaurer(i.user.id, spec), ephemeral=True)


async def setup(bot):
    global B
    B = bot
    bot.tree.add_command(grp)

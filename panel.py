"""NOLVA : panneau web. Connexion Discord (OAuth2) + petite API de réglages.

Sécurité :
- DISCORD_CLIENT_SECRET et le reste restent dans les variables Railway, jamais dans le navigateur ;
- le jeton OAuth2 n'est utilisé qu'une fois (identité + liste des serveurs) puis révoqué ;
- « state » aléatoire, lié à un cookie, contre la falsification de la connexion ;
- à CHAQUE requête, les droits de gestion du serveur sont revérifiés par le bot (pas seulement à la connexion) ;
- écritures protégées par un jeton CSRF + contrôle de l'origine ; toutes les valeurs sont validées avant d'être appliquées.
"""
import os
import time
import secrets
import hmac
import urllib.parse
from collections import defaultdict, deque

import aiohttp
import discord
from aiohttp import web

CLIENT_ID = os.getenv("DISCORD_CLIENT_ID", "1571576813761855589")
CLIENT_SECRET = os.getenv("DISCORD_CLIENT_SECRET")
_pub = (os.getenv("PUBLIC_URL") or "").strip()
if not _pub and os.getenv("RAILWAY_PUBLIC_DOMAIN"):
    _pub = os.getenv("RAILWAY_PUBLIC_DOMAIN")
if _pub and not _pub.startswith("http"):
    _pub = "https://" + _pub
PUBLIC_URL = _pub.rstrip("/")
REDIRECT = PUBLIC_URL + "/callback"
SECURE = PUBLIC_URL.startswith("https://")
API = "https://discord.com/api/v10"
INVITE_PERMS = 1099780189270
TTL = 7 * 24 * 3600
SECURITY_HEADERS = {
    "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
                               "img-src https://cdn.discordapp.com data:; connect-src 'self'; form-action 'self'; "
                               "frame-ancestors 'none'; base-uri 'none'",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
}

SESSIONS = {}
essais = defaultdict(deque)
BOT = None
FEATURES = {}
HTML = ""


class Erreur(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status, self.msg = status, msg


def rep(data, status=200):
    return web.json_response(data, status=status)


def redir(url):
    return web.Response(status=302, headers={"Location": url})


@web.middleware
async def middleware(request, handler):
    try:
        resp = await handler(request)
    except Erreur as e:
        resp = rep({"erreur": e.msg}, e.status)
    except web.HTTPException as e:
        e.headers.update(SECURITY_HEADERS)
        raise
    except Exception as e:
        print("Erreur panneau :", repr(e))
        resp = rep({"erreur": "Erreur interne."}, 500)
    resp.headers.update(SECURITY_HEADERS)
    return resp


# ---------- Outils ----------
def entier(v, lo, hi):
    if isinstance(v, bool):
        return None
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n if lo <= n <= hi else None


def egal(a, b):
    return hmac.compare_digest(str(a).encode("utf-8"), str(b).encode("utf-8"))


def limiter(request, maxi=20, fenetre=60):
    ip = (request.headers.get("X-Forwarded-For") or request.remote or "?").split(",")[-1].strip()
    q, now = essais[ip], time.time()
    while q and now - q[0] > fenetre:
        q.popleft()
    if len(q) >= maxi:
        raise Erreur(429, "Trop de tentatives : réessaie dans une minute.")
    q.append(now)
    if len(essais) > 5000:
        essais.clear()


def nouvelle_session(user, guilds):
    now = time.time()
    for k in [k for k, s in SESSIONS.items() if s["exp"] < now]:
        del SESSIONS[k]
    sid = secrets.token_urlsafe(32)
    SESSIONS[sid] = {"user": user, "guilds": guilds, "csrf": secrets.token_urlsafe(24), "exp": now + TTL}
    return sid


def exiger_session(request):
    sid = request.cookies.get("nolva_sid")
    s = SESSIONS.get(sid) if sid else None
    if not s or s["exp"] < time.time():
        raise Erreur(401, "Non connecté.")
    return s


def verifier_csrf(request, s):
    if not egal(request.headers.get("X-CSRF-Token", ""), s["csrf"]):
        raise Erreur(403, "Jeton de sécurité invalide : recharge la page.")
    origine = request.headers.get("Origin")
    if origine and origine != PUBLIC_URL:
        raise Erreur(403, "Origine refusée.")


def peut_gerer(guild, m):
    if m is None:
        return False
    p = m.guild_permissions
    return guild.owner_id == m.id or p.administrator or p.manage_guild


async def acces_serveur(request, s):
    """Vérification CÔTÉ SERVEUR : le membre doit vraiment gérer ce serveur, maintenant."""
    gid = entier(request.match_info.get("gid"), 1, 2 ** 63)
    guild = BOT.get_guild(gid) if gid else None
    if not guild:
        raise Erreur(403, "Accès refusé.")
    uid = int(s["user"]["id"])
    m = guild.get_member(uid)
    if m is None:
        try:
            m = await guild.fetch_member(uid)
        except Exception:
            m = None
    if not peut_gerer(guild, m):
        raise Erreur(403, "Accès refusé.")
    return guild


async def corps(request):
    try:
        return await request.json()
    except Exception:
        raise Erreur(400, "Requête invalide.")


# ---------- Connexion Discord ----------
async def echanger_code(code):
    """Échange le code contre un jeton, lit l'identité et les serveurs, puis révoque le jeton."""
    data = {"client_id": CLIENT_ID, "client_secret": CLIENT_SECRET, "grant_type": "authorization_code",
            "code": code, "redirect_uri": REDIRECT}
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as s:
            async with s.post(API + "/oauth2/token", data=data) as r:
                if r.status != 200:
                    return None
                tok = (await r.json())["access_token"]
            h = {"Authorization": "Bearer " + tok}
            async with s.get(API + "/users/@me", headers=h) as r:
                if r.status != 200:
                    return None
                u = await r.json()
            async with s.get(API + "/users/@me/guilds", headers=h) as r:
                if r.status != 200:
                    return None
                gs = await r.json()
            try:
                await s.post(API + "/oauth2/token/revoke", data={"client_id": CLIENT_ID, "client_secret": CLIENT_SECRET, "token": tok})
            except Exception:
                pass
    except Exception:
        return None
    user = {"id": str(u["id"]), "name": u.get("global_name") or u.get("username") or "Utilisateur", "avatar": u.get("avatar")}
    guilds = []
    for g in gs:
        perms = entier(g.get("permissions"), 0, 2 ** 64) or 0
        guilds.append({"id": str(g["id"]), "name": g.get("name", "?"), "icon": g.get("icon"),
                       "manage": bool(g.get("owner")) or bool(perms & 0x28)})  # 0x8 admin + 0x20 gérer le serveur
    return user, guilds


async def login(request):
    limiter(request)
    if not CLIENT_SECRET or not PUBLIC_URL:
        raise Erreur(503, "Le panneau n’est pas configuré : il manque DISCORD_CLIENT_SECRET ou PUBLIC_URL sur Railway.")
    state = secrets.token_urlsafe(32)
    q = urllib.parse.urlencode({"client_id": CLIENT_ID, "redirect_uri": REDIRECT, "response_type": "code",
                                "scope": "identify guilds", "state": state, "prompt": "none"})
    resp = redir("https://discord.com/oauth2/authorize?" + q)
    resp.set_cookie("nolva_state", state, max_age=600, httponly=True, secure=SECURE, samesite="Lax", path="/")
    return resp


async def callback(request):
    limiter(request)
    state, cookie = request.query.get("state", ""), request.cookies.get("nolva_state", "")
    if not state or not cookie or not egal(state, cookie):
        raise Erreur(400, "Connexion refusée (état invalide). Recommence depuis le panneau.")
    code = request.query.get("code")
    res = None if (request.query.get("error") or not code) else await echanger_code(code)
    if not res:
        resp = redir("/panel?erreur=echec")
    else:
        resp = redir("/panel")
        resp.set_cookie("nolva_sid", nouvelle_session(*res), max_age=TTL, httponly=True, secure=SECURE, samesite="Lax", path="/")
    resp.del_cookie("nolva_state", path="/")
    return resp


async def logout(request):
    s = exiger_session(request)
    verifier_csrf(request, s)
    SESSIONS.pop(request.cookies.get("nolva_sid"), None)
    resp = rep({"ok": True})
    resp.del_cookie("nolva_sid", path="/")
    return resp


async def page(request):
    return web.Response(text=HTML, content_type="text/html")


async def me(request):
    s = exiger_session(request)
    liste = []
    for g in s["guilds"]:
        if not g["manage"]:
            continue
        present = BOT.get_guild(int(g["id"])) is not None
        invite = None if present else (
            "https://discord.com/oauth2/authorize?" + urllib.parse.urlencode(
                {"client_id": CLIENT_ID, "permissions": INVITE_PERMS, "scope": "bot applications.commands",
                 "guild_id": g["id"], "disable_guild_select": "true"}))
        liste.append({"id": g["id"], "name": g["name"], "icon": g["icon"], "bot": present, "invite": invite})
    return rep({"user": s["user"], "csrf": s["csrf"], "guilds": liste})


# ---------- Réglages d'un serveur ----------
def vue_serveur(guild):
    import automations
    import premium
    import tickets
    from roles import probleme_role
    c = BOT.db.g(guild.id)
    t = tickets.cfg(guild.id)
    sid = lambda v: str(v) if v else None
    roles = [r for r in sorted(guild.roles, key=lambda r: -r.position) if not r.is_default()]
    return {
        "id": str(guild.id), "name": guild.name, "premium": premium.actif(guild.id),
        "features": {k: {"label": v, "on": bool(c["features"][k])} for k, v in FEATURES.items()},
        "antiraid": dict(c["antiraid"]),
        "channels": {"journal": sid(c["channels"]["journal"]), "bienvenue": sid(c["channels"]["bienvenue"])},
        "bienvenue_msg": c["bienvenue_msg"],
        "autorole": sid(c["autorole"]),
        "tickets": {"categorie": sid(t["categorie"]), "role_staff": sid(t["role_staff"]), "transcriptions": sid(t["transcriptions"])},
        "automations": [{"id": r["id"], "resume": automations.decrire(guild, r)} for r in automations.regles(guild.id)],
        "listes": {
            "textes": [{"id": str(ch.id), "name": ch.name} for ch in guild.text_channels],
            "categories": [{"id": str(ch.id), "name": ch.name} for ch in guild.categories],
            "roles": [{"id": str(r.id), "name": r.name} for r in roles],
            "roles_ok": [{"id": str(r.id), "name": r.name} for r in roles if not probleme_role(guild, r)],
        },
        "meta": {"declencheurs": automations.DECLENCHEURS, "actions": automations.ACTIONS,
                 "possible": {k: list(v) for k, v in automations.POSSIBLE.items()}},
    }


def _salon(guild, v, genre):
    """None = effacer ; sinon l'identifiant doit être un salon du bon type de CE serveur."""
    if v is None or v == "":
        return True, None
    n = entier(v, 1, 2 ** 63)
    ch = guild.get_channel(n) if n else None
    if isinstance(ch, genre):
        return True, ch.id
    return False, None


def appliquer(guild, c, d):
    """Valide TOUT d'abord, puis applique d'un coup. Renvoie un message d'erreur ou None."""
    import tickets
    from roles import probleme_role
    if not isinstance(d, dict):
        return "Requête invalide."
    maj = {}
    if "features" in d:
        f = d["features"]
        if not isinstance(f, dict) or any(k not in FEATURES or not isinstance(v, bool) for k, v in f.items()):
            return "Fonction invalide."
        maj["features"] = f
    if "antiraid" in d:
        bornes = {"seuil": (3, 50), "fenetre": (3, 120), "duree_min": (1, 1440)}
        a = d["antiraid"]
        if not isinstance(a, dict) or any(k not in bornes for k in a):
            return "Réglage anti-raid invalide."
        out = {}
        for k, v in a.items():
            n = entier(v, *bornes[k])
            if n is None:
                return f"Valeur invalide pour l’anti-raid ({k} : de {bornes[k][0]} à {bornes[k][1]})."
            out[k] = n
        maj["antiraid"] = out
    if "channels" in d:
        ch = d["channels"]
        if not isinstance(ch, dict) or any(k not in ("journal", "bienvenue") for k in ch):
            return "Salons invalides."
        out = {}
        for k, v in ch.items():
            ok, val = _salon(guild, v, discord.TextChannel)
            if not ok:
                return "Salon introuvable sur ce serveur."
            out[k] = val
        maj["channels"] = out
    if "bienvenue_msg" in d:
        m = d["bienvenue_msg"]
        if not isinstance(m, str) or not 1 <= len(m.strip()) <= 1500:
            return "Le message de bienvenue doit faire de 1 à 1500 caractères."
        maj["bienvenue_msg"] = m.strip()
    if "autorole" in d:
        v = d["autorole"]
        if v in (None, ""):
            maj["autorole"] = None
        else:
            n = entier(v, 1, 2 ** 63)
            role = guild.get_role(n) if n else None
            if not role:
                return "Rôle automatique introuvable."
            err = probleme_role(guild, role)
            if err:
                return err
            maj["autorole"] = role.id
    if "tickets" in d:
        tk = d["tickets"]
        if not isinstance(tk, dict) or any(k not in ("categorie", "role_staff", "transcriptions") for k in tk):
            return "Réglages de tickets invalides."
        out = {}
        for k, v in tk.items():
            if k == "role_staff":
                if v in (None, ""):
                    out[k] = None
                else:
                    n = entier(v, 1, 2 ** 63)
                    role = guild.get_role(n) if n else None
                    if not role or role.is_default():
                        return "Rôle de l’équipe introuvable."
                    out[k] = role.id
            else:
                genre = discord.CategoryChannel if k == "categorie" else discord.TextChannel
                ok, val = _salon(guild, v, genre)
                if not ok:
                    return "Salon ou catégorie introuvable sur ce serveur."
                out[k] = val
        maj["tickets"] = out
    # tout est valide : on applique
    if "features" in maj:
        c["features"].update(maj["features"])
    if "antiraid" in maj:
        c["antiraid"].update(maj["antiraid"])
    if "channels" in maj:
        c["channels"].update(maj["channels"])
    if "bienvenue_msg" in maj:
        c["bienvenue_msg"] = maj["bienvenue_msg"]
    if "autorole" in maj:
        c["autorole"] = maj["autorole"]
    if "tickets" in maj:
        tickets.cfg(guild.id).update(maj["tickets"])
    BOT.db.save()
    return None


async def guild_get(request):
    s = exiger_session(request)
    return rep(vue_serveur(await acces_serveur(request, s)))


async def guild_post(request):
    s = exiger_session(request)
    verifier_csrf(request, s)
    guild = await acces_serveur(request, s)
    err = appliquer(guild, BOT.db.g(guild.id), await corps(request))
    if err:
        raise Erreur(400, err)
    return rep(vue_serveur(guild))


async def auto_post(request):
    import automations
    s = exiger_session(request)
    verifier_csrf(request, s)
    guild = await acces_serveur(request, s)
    r, err = automations.ajouter_regle(guild, await corps(request))
    if err:
        raise Erreur(400, err)
    return rep(vue_serveur(guild))


async def auto_delete(request):
    import automations
    s = exiger_session(request)
    verifier_csrf(request, s)
    guild = await acces_serveur(request, s)
    rid = entier(request.match_info.get("rid"), 1, 2 ** 31)
    if rid is None or not automations.supprimer_regle(guild.id, rid):
        raise Erreur(404, "Automatisation introuvable.")
    return rep(vue_serveur(guild))


def make_app(bot, features):
    global BOT, FEATURES, HTML
    BOT, FEATURES = bot, features
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "panel.html"), encoding="utf-8") as f:
            HTML = f.read()
    except OSError:
        HTML = "<p>panel.html introuvable.</p>"
    app = web.Application(middlewares=[middleware], client_max_size=65536)
    app.router.add_get("/panel", page)
    app.router.add_get("/login", login)
    app.router.add_get("/callback", callback)
    app.router.add_post("/logout", logout)
    app.router.add_get("/api/me", me)
    app.router.add_get("/api/guild/{gid}", guild_get)
    app.router.add_post("/api/guild/{gid}", guild_post)
    app.router.add_post("/api/guild/{gid}/auto", auto_post)
    app.router.add_delete("/api/guild/{gid}/auto/{rid}", auto_delete)
    return app

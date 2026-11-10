"""
Add-on Discord « malveillance » : endpoint HTTP d'interactions, hébergé sur Koyeb.

Clic droit sur un membre -> Applications -> « A été malveillant(e) avec moi »
-> enregistre (date/heure, malveillant, malveillé) dans Supabase,
   1 report par couple malveillant/malveillé et par heure.
"""
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response
from nacl.exceptions import BadSignatureError
from nacl.signing import VerifyKey

from discord_commands import REPORT_COMMAND_NAME

load_dotenv()
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("malveillance")

DISCORD_PUBLIC_KEY = os.environ["DISCORD_PUBLIC_KEY"]
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_SECRET_KEY = os.environ["SUPABASE_SECRET_KEY"]

verify_key = VerifyKey(bytes.fromhex(DISCORD_PUBLIC_KEY))

SUPABASE_HEADERS = {"apikey": SUPABASE_SECRET_KEY, "Content-Type": "application/json"}
if SUPABASE_SECRET_KEY.startswith("eyJ"):  # ancienne clé service_role (JWT)
    SUPABASE_HEADERS["Authorization"] = f"Bearer {SUPABASE_SECRET_KEY}"

# Types Discord
PING, APPLICATION_COMMAND = 1, 2
PONG, CHANNEL_MESSAGE = 1, 4
EPHEMERAL = 1 << 6

http: httpx.AsyncClient


@asynccontextmanager
async def lifespan(_: FastAPI):
    global http
    # Discord exige une réponse en moins de 3 s : on coupe Supabase à 2,5 s
    http = httpx.AsyncClient(base_url=SUPABASE_URL, headers=SUPABASE_HEADERS, timeout=2.5)
    yield
    await http.aclose()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)


def reply(content: str) -> dict:
    """Message visible uniquement par la personne qui a cliqué."""
    return {
        "type": CHANNEL_MESSAGE,
        "data": {"content": content, "flags": EPHEMERAL, "allowed_mentions": {"parse": []}},
    }


def display_name(user: dict, member: dict | None = None) -> str:
    return (member or {}).get("nick") or user.get("global_name") or user["username"]


def discord_ts(iso: str) -> int:
    return int(datetime.fromisoformat(iso).timestamp())


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/interactions")
async def interactions(request: Request):
    body = await request.body()
    signature = request.headers.get("X-Signature-Ed25519", "")
    timestamp = request.headers.get("X-Signature-Timestamp", "")
    try:
        verify_key.verify(timestamp.encode() + body, bytes.fromhex(signature))
    except (BadSignatureError, ValueError):
        return Response("invalid request signature", status_code=401)

    interaction = json.loads(body)
    if interaction["type"] == PING:
        return {"type": PONG}
    if interaction["type"] == APPLICATION_COMMAND and interaction["data"]["name"] == REPORT_COMMAND_NAME:
        return await handle_report(interaction)
    return reply("Commande inconnue.")


async def handle_report(interaction: dict) -> dict:
    if "guild_id" not in interaction:
        return reply("Cette option ne fonctionne que sur un serveur.")

    member = interaction["member"]
    malveille = member["user"]
    data = interaction["data"]
    target_id = data["target_id"]
    malveillant = data["resolved"]["users"][target_id]
    malveillant_member = data["resolved"].get("members", {}).get(target_id)
    nom = display_name(malveillant, malveillant_member)

    if target_id == malveille["id"]:
        return reply("Tu ne peux pas te signaler toi-même.")
    if malveillant.get("bot"):
        return reply("Les bots ne peuvent pas être signalés.")

    try:
        resp = await http.post(
            "/rest/v1/rpc/report_malveillance",
            json={
                "p_guild_id": interaction["guild_id"],
                "p_malveillant_id": target_id,
                "p_malveillant_username": malveillant["username"],
                "p_malveille_id": malveille["id"],
                "p_malveille_username": malveille["username"],
            },
        )
        resp.raise_for_status()
        result = resp.json()[0]
    except Exception:
        log.exception("Échec de l'enregistrement dans Supabase")
        return reply("Le signalement n'a pas pu être enregistré. Réessaie dans un instant.")

    prochain = discord_ts(result["next_allowed_at"])
    if result["status"] == "cooldown":
        return reply(
            f"Tu as déjà signalé **{nom}** il y a moins d'une heure. "
            f"Tu pourras recommencer <t:{prochain}:R> (à <t:{prochain}:t>)."
        )

    log.info("Report %s -> %s", malveille["id"], target_id)
    return reply(f"C'est noté : **{nom}** a été malveillant(e) avec toi le <t:{discord_ts(result['reported_at'])}:f>.")

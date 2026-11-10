"""
Enregistre (ou met à jour) les commandes de l'add-on sur ton serveur Discord.
À lancer une fois, puis à chaque changement de discord_commands.py :
    python register_commands.py
"""
import os

import httpx
from dotenv import load_dotenv

from discord_commands import COMMANDS

load_dotenv()

app_id = os.environ["DISCORD_APPLICATION_ID"]
guild_id = os.environ["DISCORD_GUILD_ID"]
token = os.environ["DISCORD_BOT_TOKEN"]

resp = httpx.put(
    f"https://discord.com/api/v10/applications/{app_id}/guilds/{guild_id}/commands",
    headers={"Authorization": f"Bot {token}"},
    json=COMMANDS,
)
if resp.is_error:
    raise SystemExit(f"Erreur {resp.status_code} : {resp.text}")
print("Commandes enregistrées :", ", ".join(c["name"] for c in resp.json()))

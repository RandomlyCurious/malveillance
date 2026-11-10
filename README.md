# Add-on Discord « malveillance »

Clic droit sur un membre → **Applications → A été malveillant(e) avec moi**.
Chaque clic enregistre dans Supabase la date/heure, le malveillant (la personne signalée) et le malveillé (la personne qui signale).
Un même couple malveillant/malveillé ne peut être enregistré qu'une fois par heure.

L'add-on reçoit les clics de Discord en HTTP (Interactions Endpoint URL) : pas de connexion permanente,
ce qui convient au service web gratuit de Koyeb.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `app.py` | Endpoint `/interactions` appelé par Discord, et `/health` |
| `discord_commands.py` | Nom et définition de la commande |
| `register_commands.py` | Enregistre la commande sur le serveur (à lancer depuis ton PC) |
| `supabase/migrations/…sql` | Table `malveillance_reports` + fonction `report_malveillance` (déjà appliquées) |
| `Dockerfile` | Image utilisée par Koyeb |

## Variables d'environnement

| Variable | Où la trouver | Utilisée par |
| --- | --- | --- |
| `DISCORD_PUBLIC_KEY` | Developer Portal → General Information → Public Key | Koyeb |
| `SUPABASE_URL` | `https://vgzednygshdyuyjzwawz.supabase.co` | Koyeb |
| `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API Keys → Secret key (`sb_secret_…`) | Koyeb (en *Secret*) |
| `DISCORD_APPLICATION_ID` | Developer Portal → General Information → Application ID | register_commands.py |
| `DISCORD_GUILD_ID` | Clic droit sur le serveur → Copier l'identifiant | register_commands.py |
| `DISCORD_BOT_TOKEN` | Developer Portal → Bot → Reset Token | register_commands.py |

## Mise en route

1. `cp .env.example .env` et remplis les valeurs.
2. `pip install -r requirements.txt` puis `python register_commands.py`.
3. Déploie sur Koyeb (service web, instance Free, région Frankfurt, builder Dockerfile, variables ci-dessus).
4. Dans le Developer Portal → General Information → **Interactions Endpoint URL** :
   `https://<ton-app>.koyeb.app/interactions`, puis **Save Changes**.
5. Programme un ping de `https://<ton-app>.koyeb.app/health` toutes les 10 minutes (cron-job.org, UptimeRobot…)
   pour que l'instance gratuite ne s'endorme pas.

## Lire les données

```sql
select reported_at, malveillant_username, malveille_username
from public.malveillance_reports
order by reported_at desc;
```

Les identifiants Discord sont stockés en `text`, comme `players.discord_id`, pour pouvoir faire la jointure plus tard.

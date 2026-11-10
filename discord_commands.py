"""Définition des commandes Discord de l'add-on (partagée par app.py et register_commands.py)."""

# Discord limite le nom d'une commande de menu contextuel à 32 caractères.
# "Cette personne a été malveillante avec moi" en fait 42, d'où cette version courte.
REPORT_COMMAND_NAME = "A été malveillant(e) avec moi"

COMMANDS = [
    {
        "name": REPORT_COMMAND_NAME,
        "type": 2,          # 2 = commande utilisateur (clic droit sur un membre)
        "contexts": [0],    # uniquement sur un serveur
    },
]

assert all(len(c["name"]) <= 32 for c in COMMANDS), "Nom de commande trop long (32 caractères max)"

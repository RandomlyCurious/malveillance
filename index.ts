// Add-on Discord « malveillance » — Supabase Edge Function
//
// Clic droit sur un membre -> Applications -> « A été malveillant(e) avec moi »
// -> enregistre (date/heure, malveillant, malveillé) dans public.malveillance_reports,
//    1 report par couple malveillant/malveillé et par heure (fonction SQL report_malveillance).
//
// Secrets à définir dans Supabase (Edge Functions -> Secrets) :
//   DISCORD_PUBLIC_KEY, DISCORD_APPLICATION_ID, DISCORD_GUILD_ID, DISCORD_BOT_TOKEN
//
// Routes :
//   POST /malveillance                  -> appelé par Discord (Interactions Endpoint URL)
//   GET  /malveillance                  -> état de la configuration
//   GET  /malveillance?action=register  -> crée / met à jour l'option de clic droit sur le serveur

import nacl from "npm:tweetnacl@1.0.3";

// Discord limite le nom à 32 caractères
const COMMAND_NAME = "A été malveillant(e) avec moi";
const COMMANDS = [{ name: COMMAND_NAME, type: 2, contexts: [0] }]; // 2 = clic droit sur un membre

const PUBLIC_KEY = Deno.env.get("DISCORD_PUBLIC_KEY") ?? "";
const APP_ID = Deno.env.get("DISCORD_APPLICATION_ID") ?? "";
const GUILD_ID = Deno.env.get("DISCORD_GUILD_ID") ?? "";
const BOT_TOKEN = Deno.env.get("DISCORD_BOT_TOKEN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

// Clé serveur fournie automatiquement par Supabase (nouvelle clé secrète ou ancienne service_role)
function serverKey(): string {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    try {
      const k = JSON.parse(keys).default;
      if (k) return k;
    } catch { /* format inattendu : on tente l'ancienne clé */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
const SERVER_KEY = serverKey();
const DB_HEADERS: Record<string, string> = { apikey: SERVER_KEY, "Content-Type": "application/json" };
if (SERVER_KEY.startsWith("eyJ")) DB_HEADERS.Authorization = `Bearer ${SERVER_KEY}`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Message visible uniquement par la personne qui a cliqué
const reply = (content: string) =>
  json({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });

const hexToBytes = (hex: string) =>
  new Uint8Array((hex.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));

// Horodatage Discord <t:…> à partir d'une date Postgres
const discordTs = (iso: string) =>
  Math.floor(new Date(iso.replace(/(\.\d{3})\d+/, "$1")).getTime() / 1000);

function verifySignature(signature: string | null, timestamp: string | null, body: string): boolean {
  if (!PUBLIC_KEY || !signature || !timestamp || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  try {
    return nacl.sign.detached.verify(
      new TextEncoder().encode(timestamp + body),
      hexToBytes(signature),
      hexToBytes(PUBLIC_KEY),
    );
  } catch {
    return false;
  }
}

type DiscordUser = { id: string; username: string; global_name?: string | null; bot?: boolean };

async function handleReport(interaction: any): Promise<Response> {
  if (!interaction.guild_id) return reply("Cette option ne fonctionne que sur un serveur.");

  const malveille: DiscordUser = interaction.member.user;
  const targetId: string = interaction.data.target_id;
  const malveillant: DiscordUser = interaction.data.resolved.users[targetId];
  const member = interaction.data.resolved.members?.[targetId];
  const nom = member?.nick || malveillant.global_name || malveillant.username;

  if (targetId === malveille.id) return reply("Tu ne peux pas te signaler toi-même.");
  if (malveillant.bot) return reply("Les bots ne peuvent pas être signalés.");

  let result: { status: string; reported_at: string; next_allowed_at: string };
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/report_malveillance`, {
      method: "POST",
      headers: DB_HEADERS,
      body: JSON.stringify({
        p_guild_id: interaction.guild_id,
        p_malveillant_id: targetId,
        p_malveillant_username: malveillant.username,
        p_malveille_id: malveille.id,
        p_malveille_username: malveille.username,
      }),
      signal: AbortSignal.timeout(2500), // Discord exige une réponse en moins de 3 s
    });
    if (!resp.ok) throw new Error(`Supabase ${resp.status}: ${await resp.text()}`);
    result = (await resp.json())[0];
  } catch (err) {
    console.error("Échec de l'enregistrement :", err);
    return reply("Le signalement n'a pas pu être enregistré. Réessaie dans un instant.");
  }

  const prochain = discordTs(result.next_allowed_at);
  if (result.status === "cooldown") {
    return reply(
      `Tu as déjà signalé **${nom}** il y a moins d'une heure. ` +
        `Tu pourras recommencer <t:${prochain}:R> (à <t:${prochain}:t>).`,
    );
  }
  console.log(`Report ${malveille.id} -> ${targetId}`);
  return reply(`C'est noté : **${nom}** a été malveillant(e) avec toi le <t:${discordTs(result.reported_at)}:f>.`);
}

async function registerCommands(): Promise<Response> {
  const missing = Object.entries({
    DISCORD_APPLICATION_ID: APP_ID,
    DISCORD_GUILD_ID: GUILD_ID,
    DISCORD_BOT_TOKEN: BOT_TOKEN,
  }).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return json({ ok: false, error: `Secrets manquants : ${missing.join(", ")}` }, 500);

  const resp = await fetch(
    `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`,
    {
      method: "PUT",
      headers: { Authorization: `Bot ${BOT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(COMMANDS),
    },
  );
  const data = await resp.json().catch(() => null);
  if (!resp.ok) return json({ ok: false, discord_status: resp.status, discord_error: data }, 502);
  return json({ ok: true, commandes: data.map((c: { name: string }) => c.name) });
}

Deno.serve(async (req) => {
  if (req.method === "GET") {
    if (new URL(req.url).searchParams.get("action") === "register") return await registerCommands();
    return json({
      ok: true,
      secrets_configures: {
        DISCORD_PUBLIC_KEY: !!PUBLIC_KEY,
        DISCORD_APPLICATION_ID: !!APP_ID,
        DISCORD_GUILD_ID: !!GUILD_ID,
        DISCORD_BOT_TOKEN: !!BOT_TOKEN,
        cle_supabase: !!SERVER_KEY,
      },
    });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const body = await req.text();
  if (!verifySignature(req.headers.get("X-Signature-Ed25519"), req.headers.get("X-Signature-Timestamp"), body)) {
    return new Response("invalid request signature", { status: 401 });
  }

  const interaction = JSON.parse(body);
  if (interaction.type === 1) return json({ type: 1 }); // PING de Discord
  if (interaction.type === 2 && interaction.data?.name === COMMAND_NAME) return await handleReport(interaction);
  return reply("Commande inconnue.");
});

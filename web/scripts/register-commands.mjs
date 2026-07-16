/**
 * Register the bot's slash commands with Discord. Run once (and again whenever
 * a command definition changes). Uses BULK OVERWRITE (PUT), so this array is the
 * complete command set — every command the bot should have must be listed here.
 *
 *   DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... [DISCORD_GUILD_ID=...] \
 *     node scripts/register-commands.mjs
 *
 * Set DISCORD_GUILD_ID to register to a single server (instant, great for
 * testing). Omit it to register globally (can take up to ~1 hour to appear).
 */
const APP_ID = process.env.DISCORD_APP_ID;
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!APP_ID || !TOKEN) {
  console.error("Missing DISCORD_APP_ID or DISCORD_BOT_TOKEN env vars.");
  process.exit(1);
}

const commands = [
  {
    name: "scan",
    description: "Show the S/R zones and range being watched for a symbol",
    options: [
      {
        name: "symbol",
        description: "Which market (default BTC)",
        type: 3, // STRING
        required: false,
        choices: [
          { name: "BTC", value: "BTC" },
          { name: "ETH", value: "ETH" },
          { name: "SOL", value: "SOL" },
          { name: "ONDO", value: "ONDO" },
          { name: "TAO", value: "TAO" },
        ],
      },
    ],
  },
  {
    name: "position",
    description: "List the bot's open paper trades, marked to live price",
  },
  {
    name: "current-portfolio",
    description: "Paper portfolio summary: open, win rate, expectancy, P&L",
  },
];

const url = GUILD_ID
  ? `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`
  : `https://discord.com/api/v10/applications/${APP_ID}/commands`;

// PUT = bulk overwrite: the posted array becomes the full command set.
const res = await fetch(url, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(commands),
});

console.log(res.status, res.statusText);
console.log(await res.text());
if (!res.ok) process.exit(1);
console.log(
  `✅ Registered ${commands.length} commands (${commands.map((c) => "/" + c.name).join(", ")}) ` +
    (GUILD_ID ? "to guild (available immediately)." : "globally (may take up to ~1 hour)."),
);

import {
  verifyKey,
  InteractionType,
  InteractionResponseType,
} from "discord-interactions";
import { after } from "next/server";
import { SYMBOLS } from "@/lib/config";
import { buildScanEmbed, normalizeSymbol } from "@/lib/discord/scan";

export const dynamic = "force-dynamic";

/**
 * Discord slash-command (HTTP interactions) endpoint. No always-on bot needed:
 * Discord POSTs here when someone runs a command. We verify the Ed25519
 * signature, answer PINGs, and handle /scan by deferring then following up
 * (analysis can take >3s, Discord's hard reply limit).
 */
export async function POST(req: Request) {
  const sig = req.headers.get("x-signature-ed25519");
  const ts = req.headers.get("x-signature-timestamp");
  const pubKey = process.env.DISCORD_PUBLIC_KEY;
  const body = await req.text(); // raw body required for signature check

  if (!sig || !ts || !pubKey || !(await verifyKey(body, sig, ts, pubKey))) {
    return new Response("invalid request signature", { status: 401 });
  }

  const interaction = JSON.parse(body);

  if (interaction.type === InteractionType.PING) {
    return Response.json({ type: InteractionResponseType.PONG });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    if (interaction.data?.name === "scan") {
      const raw =
        interaction.data.options?.find(
          (o: { name: string }) => o.name === "symbol",
        )?.value ?? "BTC";
      const symbol = normalizeSymbol(String(raw));

      // Do the slow work after replying, then edit the deferred message.
      after(async () => {
        const followup = `https://discord.com/api/v10/webhooks/${process.env.DISCORD_APP_ID}/${interaction.token}/messages/@original`;
        let payload: object;
        if (!symbol) {
          payload = {
            content: `Unknown symbol "${raw}". Try: ${SYMBOLS.join(", ")}`,
          };
        } else {
          try {
            payload = { embeds: [await buildScanEmbed(symbol)] };
          } catch (e) {
            payload = { content: `Scan failed: ${String(e)}` };
          }
        }
        await fetch(followup, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      });

      // Immediate ack: "Bot is thinking…"
      return Response.json({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      });
    }
  }

  return new Response("unhandled interaction", { status: 400 });
}

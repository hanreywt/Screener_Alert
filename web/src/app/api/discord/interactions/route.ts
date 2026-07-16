import {
  verifyKey,
  InteractionType,
  InteractionResponseType,
} from "discord-interactions";
import { after } from "next/server";
import { SYMBOLS } from "@/lib/config";
import { buildScanEmbed, normalizeSymbol } from "@/lib/discord/scan";
import { buildPositionEmbed, buildPortfolioEmbed } from "@/lib/discord/portfolio";

export const dynamic = "force-dynamic";

/**
 * Discord slash-command (HTTP interactions) endpoint. No always-on bot needed:
 * Discord POSTs here when someone runs a command. We verify the Ed25519
 * signature, answer PINGs, and handle commands by DEFERRING then following up —
 * the work (analysis / journal + live prices) can exceed Discord's 3s reply cap.
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
    // Defer immediately ("Bot is thinking…"), then edit the reply once `build`
    // resolves. Shared by every command so each just supplies its payload.
    const deferWith = (build: () => Promise<object>) => {
      after(async () => {
        const followup = `https://discord.com/api/v10/webhooks/${process.env.DISCORD_APP_ID}/${interaction.token}/messages/@original`;
        let payload: object;
        try {
          payload = await build();
        } catch (e) {
          payload = { content: `Command failed: ${String(e)}` };
        }
        await fetch(followup, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      });
      return Response.json({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      });
    };

    const name = interaction.data?.name;

    if (name === "scan") {
      const raw =
        interaction.data.options?.find(
          (o: { name: string }) => o.name === "symbol",
        )?.value ?? "BTC";
      const symbol = normalizeSymbol(String(raw));
      return deferWith(async () =>
        symbol
          ? { embeds: [await buildScanEmbed(symbol)] }
          : { content: `Unknown symbol "${raw}". Try: ${SYMBOLS.join(", ")}` },
      );
    }

    if (name === "position") {
      return deferWith(async () => ({ embeds: [await buildPositionEmbed()] }));
    }

    if (name === "current-portfolio") {
      return deferWith(async () => ({ embeds: [await buildPortfolioEmbed()] }));
    }
  }

  return new Response("unhandled interaction", { status: 400 });
}

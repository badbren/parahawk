import {
  Client,
  GatewayIntentBits,
  Events,
  ActivityType,
  type TextBasedChannel,
} from "discord.js";
import { config } from "../config.js";
import { commandMap } from "./commands.js";
import { brandEmbed } from "./embeds.js";
import { bus } from "../events.js";
import { currentPotHours } from "../pollers/index.js";
import { fmtHashrate, fmtInt, fmtDuration, fmtPhd } from "../web/format.js";

let client: Client | null = null;

/** Post an embed to a channel id, swallowing any error (bot must never crash). */
async function postTo(channelId: string, build: () => ReturnType<typeof brandEmbed>): Promise<void> {
  try {
    if (!client) return;
    const ch = await client.channels.fetch(channelId);
    if (ch && ch.isTextBased() && "send" in ch) {
      await (ch as TextBasedChannel & { send: Function }).send({ embeds: [build()] });
    }
  } catch (err) {
    console.error("[bot:post]", (err as Error).message);
  }
}

export function startBot(): void {
  if (!config.discord.token) {
    console.log("🤖 bot disabled (no DISCORD_TOKEN)");
    return;
  }

  client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, (c) => {
    console.log(`🤖 bot online as ${c.user.tag}`);
    updatePresence();
    setInterval(updatePresence, 60_000);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const cmd = commandMap.get(interaction.commandName);
    if (!cmd) return;
    try {
      await cmd.execute(interaction);
    } catch (err) {
      console.error(`[bot:cmd:${interaction.commandName}]`, (err as Error).message);
      const msg = "⚠ Something went wrong running that command.";
      try {
        if (interaction.deferred || interaction.replied) await interaction.editReply(msg);
        else await interaction.reply({ content: msg, ephemeral: true });
      } catch {
        /* ignore */
      }
    }
  });

  // Block-found alert → configured channel
  bus.onBlockFound((e) => {
    const target = config.discord.alertChannelId;
    if (!target) return;
    postTo(target, () =>
      brandEmbed(0x8fd14f)
        .setTitle(`🥑 FRESH POT — Parasite found block #${fmtInt(e.height)}!`)
        .setDescription("The pot just reset to zero — a brand-new cycle begins. 🟢")
        .addFields(
          { name: "Pool hashrate", value: fmtHashrate(e.poolHashratePhs), inline: true },
          { name: "Hashprice", value: `${fmtInt(e.hashpriceSatsPerPhd)} sats/PHd`, inline: true },
          { name: "Previous cycle", value: `${e.cycleDurationBlocks} blocks · ~${fmtPhd(e.estCyclePhd)} banked`, inline: true },
        ),
    );
  });

  // Watchdog alerts → subscription's channel
  bus.onWatchAlert((e) => {
    postTo(e.channelId, () =>
      brandEmbed(e.kind === "fulfilled" ? 0x8fd14f : 0xf5c451)
        .setTitle(e.kind === "fulfilled" ? "✅ Order fulfilled" : "⚠ Order stuck at 0%")
        .setDescription(`${e.address.slice(0, 10)}…${e.address.slice(-4)}\n${e.detail}`),
    );
  });

  client.login(config.discord.token).catch((err) => {
    console.error("[bot:login]", (err as Error).message);
  });
}

async function updatePresence(): Promise<void> {
  try {
    if (!client?.user) return;
    const hours = await currentPotHours();
    client.user.setActivity(`🥑 pot ${fmtDuration(hours)}`, { type: ActivityType.Watching });
  } catch {
    /* ignore */
  }
}

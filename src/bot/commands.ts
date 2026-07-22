import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import { brandEmbed, verdictColor } from "./embeds.js";
import { config } from "../config.js";
import { getOverview } from "../services/overview.js";
import { estimateCurrentPotPhd } from "../services/pot.js";
import { getStore } from "../db/index.js";
import { getUserStats } from "../data/parasite.js";
import { oddsForWork } from "../math/odds.js";
import { computeOdometer } from "../math/work.js";
import {
  fmtHashrate,
  fmtInt,
  fmtDiff,
  fmtUsd,
  fmtDuration,
  fmtPhd,
  potEmoji,
  hashpriceEmoji,
} from "../web/format.js";

export interface Command {
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  execute(i: ChatInputCommandInteraction): Promise<void>;
}

function pct(p: number): string {
  const v = p * 100;
  if (v >= 99.99) return "≈100%";
  if (v > 0 && v < 0.01) return "<0.01%";
  return `${v.toFixed(v < 1 ? 2 : 1)}%`;
}

function isBc1(addr: string): boolean {
  return /^bc1[0-9a-z]{6,87}$/i.test(addr.trim());
}

// ── /pot ────────────────────────────────────────────────────────────────────
const pot: Command = {
  data: new SlashCommandBuilder()
    .setName("pot")
    .setDescription("Current pot age, pool hashrate, and estimated PHd banked")
    .toJSON(),
  async execute(i) {
    const o = await getOverview();
    const estPhd = await estimateCurrentPotPhd(getStore(), o);
    const v = o.potAge.verdict;
    const note =
      v === "fresh"
        ? "🟢 fresh — full pot recently reset"
        : v === "aging"
          ? "🟡 aging — pot filling up"
          : "🔴 stale — many wait for the reset before renting";
    const embed = brandEmbed(verdictColor(v))
      .setTitle(`${potEmoji(v)} Pot age — ${fmtDuration(o.potAge.hours)}`)
      .setDescription(note)
      .addFields(
        { name: "Blocks since last found", value: `${o.potAge.blocks} (since #${fmtInt(o.pool.lastFoundHeight)})`, inline: true },
        { name: "Pool hashrate", value: fmtHashrate(o.pool.poolHashratePhs), inline: true },
        { name: "Est. PHd banked", value: fmtPhd(estPhd), inline: true },
      );
    await i.reply({ embeds: [embed] });
  },
};

// ── /price ──────────────────────────────────────────────────────────────────
const price: Command = {
  data: new SlashCommandBuilder()
    .setName("price")
    .setDescription("Refinery hashprice vs the ~50k sats/PHd fair-value baseline")
    .toJSON(),
  async execute(i) {
    const o = await getOverview();
    const hp = o.hashprice;
    const embed = brandEmbed(verdictColor(hp.verdict))
      .setTitle(`${hashpriceEmoji(hp.verdict)} Refinery hashprice — ${hp.verdict}`)
      .addFields(
        { name: "Hashprice", value: `${fmtInt(hp.satsPerPhd)} sats/PHd`, inline: true },
        { name: "USD", value: `${fmtUsd(hp.usdPerPhd)}/PHd`, inline: true },
        { name: "vs 50k baseline", value: `${(hp.ratio * 100).toFixed(0)}%`, inline: true },
      )
      .setDescription(
        hp.verdict === "good"
          ? "Cheaper than baseline — more work per sat."
          : hp.verdict === "expensive"
            ? "Above baseline — renting is pricey right now."
            : "Around fair value.",
      );
    await i.reply({ embeds: [embed] });
  },
};

// ── /odds <phd> ───────────────────────────────────────────────────────────────
const odds: Command = {
  data: new SlashCommandBuilder()
    .setName("odds")
    .setDescription("Odds of a 10T/21T share or a block for a given amount of work")
    .addNumberOption((o) =>
      o.setName("phd").setDescription("Work in PHd (petahash-days)").setRequired(true).setMinValue(0),
    )
    .toJSON(),
  async execute(i) {
    const phd = i.options.getNumber("phd", true);
    const r = oddsForWork(phd);
    const embed = brandEmbed()
      .setTitle(`🎲 Odds for ${fmtPhd(phd)} of work`)
      .addFields(
        { name: "🥑 10T share (Bravocado)", value: pct(r.tenTChance), inline: true },
        { name: "🏠 21T share (homeminers)", value: pct(r.twentyOneTChance), inline: true },
        { name: "🎰 Block", value: pct(r.blockChance), inline: true },
        { name: "Expected pleb-share return", value: `~${Math.round(r.expectedPlebReturn * 100)}% of rental cost (long-run)`, inline: false },
      )
      .setDescription("P(≥1 hit) = 1 − e^(−W/rate). Long-run odds — variance is large.");
    await i.reply({ embeds: [embed] });
  },
};

// ── /odometer <bc1q> ──────────────────────────────────────────────────────────
const odometer: Command = {
  data: new SlashCommandBuilder()
    .setName("odometer")
    .setDescription("Lifetime PHd, best difficulty, and badge math for an address")
    .addStringOption((o) => o.setName("address").setDescription("bc1q… address").setRequired(true))
    .toJSON(),
  async execute(i) {
    const addr = i.options.getString("address", true).trim();
    if (!isBc1(addr)) {
      await i.reply({ content: "That doesn't look like a bc1 address.", ephemeral: true });
      return;
    }
    await i.deferReply();
    const o = await getOverview();
    const u = await getUserStats(addr);
    const odo = computeOdometer(u.totalWorkDiff, u.bestDifficulty, o.pool.networkDifficulty);
    const luck = odo.luckRatio >= 1.1 ? "🍀 luckier than expected" : odo.luckRatio <= 0.9 ? "🥲 below expectation" : "≈ on expectation";
    const badge10 = oddsForWork(odo.lifetimePhd).tenTChance;
    const badge21 = oddsForWork(odo.lifetimePhd).twentyOneTChance;
    const embed = brandEmbed()
      .setTitle(`📟 Odometer — ${addr.slice(0, 10)}…${addr.slice(-4)}`)
      .addFields(
        { name: "Lifetime work", value: fmtPhd(odo.lifetimePhd), inline: true },
        { name: "Live hashrate", value: fmtHashrate(u.hashratePhs), inline: true },
        { name: "Best difficulty", value: fmtDiff(odo.bestDiff), inline: true },
        { name: "Best diff vs block", value: `${odo.bestDiffBlockPercent.toFixed(3)}% of a block`, inline: true },
        { name: "Luck", value: `${odo.luckRatio.toFixed(2)}× · ${luck}`, inline: true },
        { name: "Badge odds so far", value: `10T ${pct(badge10)} · 21T ${pct(badge21)}`, inline: true },
      )
      .setDescription(`Expected best diff ~${fmtDiff(odo.expectedBestDiffMin)}–${fmtDiff(odo.expectedBestDiffMax)} for this much work.`)
      .setURL(`${webBase()}/address/${addr}`);
    await i.editReply({ embeds: [embed] });
  },
};

// ── /watch <bc1q> and /unwatch ───────────────────────────────────────────────
const watch: Command = {
  data: new SlashCommandBuilder()
    .setName("watch")
    .setDescription("Watch an address's Refinery orders — alerts on stuck (0% >2h) and fulfilled")
    .addStringOption((o) => o.setName("address").setDescription("bc1q… address").setRequired(true))
    .toJSON(),
  async execute(i) {
    const addr = i.options.getString("address", true).trim();
    if (!isBc1(addr)) {
      await i.reply({ content: "That doesn't look like a bc1 address.", ephemeral: true });
      return;
    }
    await getStore().addWatch({
      discordUserId: i.user.id,
      channelId: i.channelId,
      address: addr,
    });
    await i.reply({
      content: `👁 Watching **${addr.slice(0, 10)}…${addr.slice(-4)}** in this channel. I'll ping on stuck (0% >2h) or fulfilled orders. Use \`/unwatch\` to stop.`,
    });
  },
};

const unwatch: Command = {
  data: new SlashCommandBuilder()
    .setName("unwatch")
    .setDescription("Stop watching an address")
    .addStringOption((o) => o.setName("address").setDescription("bc1q… address").setRequired(true))
    .toJSON(),
  async execute(i) {
    const addr = i.options.getString("address", true).trim();
    const removed = await getStore().removeWatch(i.user.id, addr);
    await i.reply({
      content: removed ? `🚫 Stopped watching ${addr.slice(0, 10)}…` : "You weren't watching that address.",
      ephemeral: true,
    });
  },
};

function webBase(): string {
  return config.publicBaseUrl || `http://localhost:${config.port}`;
}

export const commands: Command[] = [pot, price, odds, odometer, watch, unwatch];
export const commandMap = new Map(commands.map((c) => [c.data.name, c]));

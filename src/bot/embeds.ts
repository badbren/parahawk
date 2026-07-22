import { EmbedBuilder } from "discord.js";
import { config } from "../config.js";

const GREEN = 0x8fd14f;
const AMBER = 0xf5c451;
const RED = 0xff5c5c;

export function verdictColor(v: "fresh" | "aging" | "stale" | "good" | "normal" | "expensive"): number {
  if (v === "fresh" || v === "good") return GREEN;
  if (v === "aging" || v === "normal") return AMBER;
  return RED;
}

/**
 * Base embed with the tip jar in the footer, per spec (every embed shows the
 * Lightning address). Falls back to a gentle nudge when unset.
 */
export function brandEmbed(color: number = GREEN): EmbedBuilder {
  const footer = config.lightningAddress
    ? `⚡ tips keep Parahawk free · ${config.lightningAddress}`
    : "⚡ Parahawk — free & tip-funded";
  return new EmbedBuilder().setColor(color).setFooter({ text: footer });
}

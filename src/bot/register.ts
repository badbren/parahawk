import { REST, Routes } from "discord.js";
import { config } from "../config.js";
import { commands } from "./commands.js";

/**
 * Register slash commands with Discord. Run with `npm run register-commands`.
 * If DISCORD_GUILD_ID is set, registers to that guild (instant); otherwise
 * registers globally (can take up to ~1h to propagate).
 */
async function main(): Promise<void> {
  const { token, clientId, guildId } = config.discord;
  if (!token || !clientId) {
    console.error("Set DISCORD_TOKEN and DISCORD_CLIENT_ID in .env first.");
    process.exit(1);
  }

  const rest = new REST({ version: "10" }).setToken(token);
  const body = commands.map((c) => c.data);

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
    console.log(`✅ Registered ${body.length} commands to guild ${guildId}.`);
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body });
    console.log(`✅ Registered ${body.length} global commands (may take ~1h to appear).`);
  }
}

main().catch((err) => {
  console.error("register failed:", err);
  process.exit(1);
});

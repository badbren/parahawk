import { config } from "./config.js";
import { startServer } from "./web/server.js";
import { seedMockHistory } from "./db/index.js";
import { startPollers } from "./pollers/index.js";
import { startBot } from "./bot/bot.js";
import { canStartBot } from "./config.js";

async function main(): Promise<void> {
  console.log(`🦅 Parahawk starting — mock=${config.mockData}`);
  // Start the web server first so the site is up immediately.
  startServer();
  // Seed synthetic history (once, if the store is empty) before pollers run so
  // the empty-store check isn't defeated by a freshly-written live sample.
  await seedMockHistory().catch((err) => console.error("seed:", (err as Error).message));
  startPollers();
  if (canStartBot()) startBot();
  else console.log("🤖 bot not started (ENABLE_BOT/ DISCORD_TOKEN unset)");
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});

// Never let an unhandled rejection kill the process (bot/pollers must survive).
process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("uncaughtException:", err);
});

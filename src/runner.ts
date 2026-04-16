import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the bot script. 
// Assuming this is run as "node dist/runner.js" or "tsx src/runner.ts"
// We want to run the compiled bot in production usually.
const botScript = path.join(__dirname, "../dist/bot.js");

function startBot() {
  console.log("Starting bot...");
  const bot = spawn("node", [botScript], { stdio: "inherit" });

  bot.on("close", (code) => {
    if (code === 0) {
      console.log("Bot requested shutdown (code 0). Exiting runner.");
      process.exit(0);
    } else {
      console.log(`Bot exited with code ${code}. Restarting in 1 second...`);
      setTimeout(startBot, 1000);
    }
  });

  bot.on("error", (err) => {
    console.error("Failed to start bot process:", err);
    setTimeout(startBot, 5000);
  });
}

startBot();

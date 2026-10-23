const chalk = require("chalk");
console.log(chalk.green("TEST BOT ONLINE — token starts with:"), (process.env.DISCORD_TOKEN || "none").slice(0, 12));
let n = 0;
setInterval(() => { n++; console.log(chalk.magenta("heartbeat #" + n) + " | uptime " + process.uptime().toFixed(0) + "s"); }, 1000);
process.on("SIGTERM", () => { console.log("bot got SIGTERM, clean exit"); process.exit(0); });

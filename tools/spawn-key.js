#!/usr/bin/env node
"use strict";
/**
 * Vaxtor — private key summoner CLI for Dev.
 * Fires a key straight into the middleware (ตัวกลาง) from any private machine.
 *
 *   node tools/spawn-key.js --rank plus --count 5
 *   node tools/spawn-key.js --rank pro
 *   node tools/spawn-key.js --rank max --count 2 --url http://localhost:3200 --secret <secret>
 */
const path = require("path");
const fs = require("fs");

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}

const url = arg("url", process.env.KEYSERVER_URL || "http://localhost:3200");
const secret = arg("secret", process.env.VAXTOR_KEY_SECRET || readSecret());
const rank = arg("rank", "plus");
const count = Number(arg("count", "1"));

function readSecret() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "config.json"), "utf8"));
    return cfg.keySecret;
  } catch (_) {
    return null;
  }
}

(async () => {
  if (!secret) {
    console.error("No secret. Run keyserver once (it creates data/config.json) or pass --secret / VAXTOR_KEY_SECRET.");
    process.exit(1);
  }
  const res = await fetch(url.replace(/\/$/, "") + "/api/keys/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Key-Secret": secret },
    body: JSON.stringify({ rank, count }),
  });
  const json = await res.json();
  if (!json.ok) {
    console.error("Failed:", json.error || res.status);
    process.exit(1);
  }
  console.log(`\n  Summoned ${json.keys.length}x ${rank} key(s) into the middleware:\n`);
  for (const k of json.keys) console.log("   ", k.key);
  console.log("");
})();

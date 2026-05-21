#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const args = process.argv.slice(2);
const tokenIdx = args.indexOf("--token");
let token = tokenIdx !== -1 ? args[tokenIdx + 1] : args.find(a => a.startsWith("--token="))?.split("=")[1];

async function main() {
  let isLocal = !token;

  if (!token && args.length === 0) {
    const rl = createInterface({ input, output });
    
    console.log(`\n  🦍 Gorille d'initialisation SilverBackBase — Trail\n`);
    console.log(`  Comment souhaitez-vous utiliser Trail ?`);
    console.log(`  1. Cloud managé (Recommandé — Zéro configuration, rapports centralisés)`);
    console.log(`  2. Local open source (SQLite local, vos propres clés et base de données)`);
    
    const choice = await rl.question(`\n  Saisissez votre choix (1 ou 2, défaut: 1) : `);
    const sanitizedChoice = choice.trim();

    if (sanitizedChoice === "2") {
      isLocal = true;
      console.log(`\n  ✓ Mode Local open source sélectionné.`);
    } else {
      isLocal = false;
      console.log(`\n  ✓ Mode Cloud managé sélectionné.`);
      const inputToken = await rl.question(`  Entrez votre clé d'API (générée sur le site web, format sb_live_...) : `);
      token = inputToken.trim();
      if (!token) {
        console.error(`\n  ❌ Erreur : La clé d'API ne peut pas être vide.`);
        rl.close();
        process.exit(1);
      }
      if (!token.startsWith("sb_")) {
        console.error(`\n  ❌ Erreur : Format de clé d'API invalide. Elle doit commencer par "sb_".`);
        rl.close();
        process.exit(1);
      }
    }
    rl.close();
  }

  const TRAIL_MCP_URL = "https://trail.silverbackbase.com/mcp";

  const mcpEntry = isLocal
    ? { command: "npx", args: ["-y", "--package=@silverbackbase/trail", "trail-mcp"] }
    : { type: "http", url: TRAIL_MCP_URL, headers: { Authorization: `Bearer ${token}` } };

  function upsert(configPath: string) {
    let config: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      try { config = JSON.parse(readFileSync(configPath, "utf-8")); } catch {}
    } else {
      mkdirSync(dirname(configPath), { recursive: true });
    }
    const servers = (config.mcpServers as Record<string, unknown>) ?? {};
    servers.trail = mcpEntry;
    config.mcpServers = servers;
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  }

  const home = homedir();

  const clients = [
    {
      name: "Claude Code",
      path: join(home, ".claude.json"),
    },
    {
      name: "Claude Desktop",
      path: process.platform === "win32"
        ? join(process.env.APPDATA ?? home, "Claude", "claude_desktop_config.json")
        : join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    },
    {
      name: "Cursor",
      path: join(process.cwd(), ".cursor", "mcp.json"),
    },
  ];

  const configured: string[] = [];

  for (const client of clients) {
    if (existsSync(client.path)) {
      upsert(client.path);
      configured.push(client.name);
    }
  }

  if (!configured.includes("Claude Code")) {
    upsert(clients[0].path);
    configured.push("Claude Code");
  }

  console.log("\n  Trail MCP configuré avec succès !\n");
  configured.forEach(name => console.log(`  ✓ ${name}`));
  console.log(`\n  Mode   : ${isLocal ? "local — SQLite, zéro config" : "cloud — trail.silverbackbase.com"}`);
  if (!isLocal) console.log(`  Token  : ${token}`);
  console.log("\n  Redémarrez votre agent IA pour activer Trail.\n");
}

main().catch((err) => {
  console.error("\n  ❌ Une erreur est survenue lors de l'initialisation :", err);
  process.exit(1);
});

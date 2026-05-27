#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

const args = process.argv.slice(2).filter(a => a !== "init");
const tokenIdx = args.indexOf("--token");
let cliToken: string | undefined = tokenIdx !== -1 ? args[tokenIdx + 1] : args.find(a => a.startsWith("--token="))?.split("=")[1];

const UNIFIED_MCP_URL = "https://mcp.silverbackbase.com/mcp";
const SKILL_NAME = "trail-attribution-sbb";

function configHasUnifiedMcp(configPath: string): boolean {
  if (!existsSync(configPath)) return false;
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
    return Object.values(servers).some(s => {
      const server = s as Record<string, unknown>;
      if (typeof server?.url === "string" && server.url.includes("mcp.silverbackbase.com")) return true;
      if (Array.isArray(server?.args)) {
        return (server.args as string[]).some(a => typeof a === "string" && a.includes("mcp.silverbackbase.com"));
      }
      return false;
    });
  } catch {
    return false;
  }
}

function extractTokenFromConfig(configPath: string): string | undefined {
  if (!existsSync(configPath)) return undefined;
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
    for (const s of Object.values(servers)) {
      const server = s as Record<string, unknown>;
      const headers = server?.headers as Record<string, string> | undefined;
      if (headers?.Authorization?.startsWith("Bearer sb_")) {
        return headers.Authorization.replace("Bearer ", "");
      }
      if (Array.isArray(server?.args)) {
        const a = server.args as string[];
        const hi = a.indexOf("--header");
        if (hi !== -1 && a[hi + 1]?.startsWith("Authorization: Bearer ")) {
          return a[hi + 1].replace("Authorization: Bearer ", "");
        }
      }
    }
  } catch {}
  return undefined;
}

function configHasUnifiedMcpToml(configPath: string): boolean {
  if (!existsSync(configPath)) return false;
  try {
    const config = parseToml(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    const servers = (config.mcp_servers ?? {}) as Record<string, unknown>;
    return Object.values(servers).some(s => {
      const server = s as Record<string, unknown>;
      return typeof server?.url === "string" && server.url.includes("mcp.silverbackbase.com");
    });
  } catch {
    return false;
  }
}

function extractTokenFromConfigToml(configPath: string): string | undefined {
  if (!existsSync(configPath)) return undefined;
  try {
    const config = parseToml(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    const servers = (config.mcp_servers ?? {}) as Record<string, unknown>;
    for (const s of Object.values(servers)) {
      const server = s as Record<string, unknown>;
      const headers = server?.http_headers as Record<string, string> | undefined;
      const auth = headers?.Authorization ?? headers?.authorization;
      if (auth?.startsWith("Bearer sb_")) return auth.replace("Bearer ", "");
    }
  } catch {}
  return undefined;
}

function upsertMcpToml(configPath: string, token: string) {
  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try { config = parseToml(readFileSync(configPath, "utf-8")) as Record<string, unknown>; } catch {}
  } else {
    mkdirSync(dirname(configPath), { recursive: true });
  }
  const servers = (config.mcp_servers as Record<string, unknown>) ?? {};
  servers["silverbackbase"] = { url: UNIFIED_MCP_URL, http_headers: { Authorization: `Bearer ${token}` } };
  config.mcp_servers = servers;
  writeFileSync(configPath, stringifyToml(config), "utf-8");
}

function upsertMcp(configPath: string, token: string) {
  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try { config = JSON.parse(readFileSync(configPath, "utf-8")); } catch {}
  } else {
    mkdirSync(dirname(configPath), { recursive: true });
  }
  const servers = (config.mcpServers as Record<string, unknown>) ?? {};
  servers["silverbackbase"] = { type: "http", url: UNIFIED_MCP_URL, headers: { Authorization: `Bearer ${token}` } };
  config.mcpServers = servers;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

function installSkill(skillsDir: string): boolean {
  const __dir = dirname(fileURLToPath(import.meta.url));
  const src = join(__dir, "..", "assets", "skills", SKILL_NAME, "SKILL.md");
  if (!existsSync(src)) return false;
  const dest = join(skillsDir, SKILL_NAME, "SKILL.md");
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  return true;
}

async function main() {
  const home = homedir();

  const claudeDesktopPath = process.platform === "win32"
    ? join(process.env.APPDATA ?? home, "Claude", "claude_desktop_config.json")
    : join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");

  const mcpClients = [
    { name: "Claude Code",    path: join(home, ".claude.json"),   format: "json" as const },
    { name: "Claude Desktop", path: claudeDesktopPath,            format: "json" as const },
  ];

  const hasMcp     = (c: typeof mcpClients[number]) => configHasUnifiedMcp(c.path);
  const extractToken = (c: typeof mcpClients[number]) => extractTokenFromConfig(c.path);
  const writeMcp   = (c: typeof mcpClients[number], t: string) => upsertMcp(c.path, t);

  const rl = createInterface({ input, output });
  console.log(`\n  🦍 SilverBackBase — Trail\n`);

  // Detect which clients have the unified MCP and which don't
  const withMcp    = mcpClients.filter(c => existsSync(c.path) && hasMcp(c));
  const withoutMcp = mcpClients.filter(c => existsSync(c.path) && !hasMcp(c));

  // Try to get the token from an existing config, then from CLI arg
  let token = cliToken ?? withMcp.map(c => extractToken(c)).find(Boolean);

  const mcpConfigured: string[] = [];

  if (withoutMcp.length > 0) {
    // Always configure Claude Code even if its config file doesn't exist yet
    const claudeCodeClient = mcpClients[0];
    const missingWithClaudeCode = withoutMcp.some(c => c.name === "Claude Code")
      ? withoutMcp
      : (!existsSync(claudeCodeClient.path) ? [claudeCodeClient, ...withoutMcp] : withoutMcp);

    const missingNames = missingWithClaudeCode.map(c => c.name).join(", ");

    if (token) {
      // Ask if they want to install on missing clients
      const source = withMcp.length > 0 ? ` (token récupéré depuis ${withMcp[0].name})` : "";
      console.log(`  Le MCP SilverBackBase n'est pas encore configuré sur : ${missingNames}`);
      console.log(`  Il sera ajouté automatiquement${source}.\n`);
      const ans = (await rl.question(`  Confirmer ? (Y/n) : `)).trim().toLowerCase();
      if (ans !== "n") {
        for (const client of missingWithClaudeCode) {
          writeMcp(client, token);
          mcpConfigured.push(client.name);
        }
      }
    } else {
      // No token found anywhere — ask for it
      token = (await rl.question(`  Entrez votre clé d'API (format sb_live_...) : `)).trim();
      if (!token || !token.startsWith("sb_")) {
        console.error(`\n  ❌ Clé d'API invalide.`);
        rl.close();
        process.exit(1);
      }
      for (const client of missingWithClaudeCode) {
        writeMcp(client, token);
        mcpConfigured.push(client.name);
      }
    }
  }

  rl.close();

  // Install skill in all detected agent clients
  const skillTargets = [
    { name: "Claude Code", dir: join(home, ".claude", "skills") },
  ];

  const skillInstalled: string[] = [];
  for (const target of skillTargets) {
    if (installSkill(target.dir)) skillInstalled.push(target.name);
  }

  // Summary
  console.log("\n  Trail configuré !\n");
  if (withMcp.length > 0 && mcpConfigured.length === 0) {
    withMcp.forEach(c => console.log(`  ✓ MCP déjà présent — ${c.name}`));
  }
  mcpConfigured.forEach(name => console.log(`  ✓ MCP installé — ${name}`));
  skillInstalled.forEach(name => console.log(`  ✓ Skill installé — ${name}`));
  console.log("\n  Redémarre ton agent IA pour activer Trail.\n");
}

main().catch((err) => {
  console.error("\n  ❌ Une erreur est survenue :", err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Dev launcher: picks a free port and points `tauri dev` at it.
 *
 * Vite's default 5173 is shared with every other Vite project on the
 * machine, and Tauri cannot follow Vite's auto-incremented port because it
 * has to know the dev server URL before it starts. So the port is chosen
 * here and handed to both sides: Vite picks it up from SNIPJET_DEV_PORT,
 * Tauri from the devUrl in the generated config.
 *
 * Vite itself is left to Tauri to start, through beforeDevCommand, so that
 * Tauri owns its lifetime and the two never outlive each other.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_DIR = join(ROOT, ".local");
const MERGED_CONF = join(LOCAL_DIR, "tauri.dev.conf.json");
const TAURI_BIN = join(ROOT, "node_modules", "@tauri-apps", "cli", "tauri.js");
const DEV_CONF = join(ROOT, "src-tauri", "tauri.dev.conf.json");

// Above Vite's default range and away from Tauri's built-in dev server
// port, so a picked port is unlikely to collide with another tool.
const PORT_MIN = 5180;
const PORT_MAX = 5290;

const isFree = (port) =>
  new Promise((done) => {
    const probe = createServer();
    probe.once("error", () => done(false));
    probe.once("listening", () => probe.close(() => done(true)));
    probe.listen(port, "127.0.0.1");
  });

async function pickPort() {
  const preset = Number(process.env.SNIPJET_DEV_PORT);
  if (preset) {
    if (!(await isFree(preset))) {
      throw new Error(`SNIPJET_DEV_PORT=${preset} is already in use`);
    }
    return preset;
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const port = PORT_MIN + Math.floor(Math.random() * (PORT_MAX - PORT_MIN));
    if (await isFree(port)) return port;
  }
  throw new Error(`no free port between ${PORT_MIN} and ${PORT_MAX}`);
}

const port = await pickPort();

// Tauri reads build.devUrl before it starts, so the merged config is
// written up front with the chosen port. beforeDevCommand is left alone,
// so Tauri still starts Vite and owns its lifetime.
mkdirSync(LOCAL_DIR, { recursive: true });
writeFileSync(
  MERGED_CONF,
  `${JSON.stringify({ build: { devUrl: `http://localhost:${port}` } }, null, 2)}\n`
);

console.log(`[dev] vite port ${port}`);

const tauri = spawn(
  process.execPath,
  [TAURI_BIN, "dev", "--config", DEV_CONF, "--config", MERGED_CONF],
  {
    cwd: ROOT,
    stdio: "inherit",
    // The beforeDevCommand hook inherits this, and vite.config.js reads it.
    env: { ...process.env, SNIPJET_DEV_PORT: String(port) },
  }
);

let closing = false;
function cleanup() {
  rmSync(MERGED_CONF, { force: true });
}
function shutdown(code) {
  if (closing) return;
  closing = true;
  cleanup();
  process.exit(code);
}

// Covers the normal exit path; the signal handlers below cover Ctrl+C.
process.on("exit", () => {
  if (closing) return;
  closing = true;
  cleanup();
});

tauri.on("exit", (code) => shutdown(code ?? 0));
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

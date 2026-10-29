#!/usr/bin/env node
// Emite o status v1 lido pelo Dev Dashboard (prod:status): revisão do checkout
// em produção + estado do serviço. Somente leitura.
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readyUrl =
  process.env.HOME_MUSIC_READY_URL ?? "http://127.0.0.1:8787/ready";

function run(command, args) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 2_000,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function serviceActive() {
  try {
    return run("systemctl", ["is-active", "home-music"]) === "active";
  } catch {
    return false;
  }
}

async function ready() {
  try {
    const response = await fetch(readyUrl, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const revision = run("git", ["rev-parse", "--verify", "HEAD"]);
const state = !serviceActive()
  ? "unavailable"
  : (await ready())
    ? "ready"
    : "degraded";

console.log(
  `DEV_DASHBOARD_PRODUCTION_STATUS_V1=${JSON.stringify({ version: 1, revision, state })}`,
);

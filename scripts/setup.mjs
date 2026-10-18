import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./check-runtime.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--offline")) throw new Error("Usage: node scripts/setup.mjs [--offline]");
if (process.exitCode) process.exit(process.exitCode);
const offline = args.includes("--offline");
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const expected = "pnpm@11.25.0";
if (manifest.packageManager !== expected) throw new Error(`Expected ${expected}; preserve the existing lockfile/toolchain.`);
const env = {
  ...process.env,
  COREPACK_HOME: path.join(root, ".sites-runtime/corepack"),
  COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  ...(offline ? { COREPACK_ENABLE_NETWORK: "0" } : {}),
  CI: "true",
  SHARP_IGNORE_GLOBAL_LIBVIPS: "1",
};
function corepack(args, capture = false) {
  const result = spawnSync("corepack", ["pnpm", ...args], {
    cwd: root, env, encoding: "utf8", stdio: capture ? "pipe" : "inherit",
  });
  if (result.error) throw new Error(`Corepack is required with Node 22.23.3: ${result.error.message}`);
  if (result.status !== 0) {
    if (capture) console.error(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout?.trim();
}
if (corepack(["--version"], true) !== "11.25.0") throw new Error(`Expected ${expected}.`);
corepack(["install", "--frozen-lockfile", "--prod=false", "--ignore-scripts=false",
  "--store-dir", path.join(root, ".sites-runtime/pnpm-store"),
  "--cache-dir", path.join(root, ".sites-runtime/pnpm-store/policy-cache"),
  "--package-import-method=clone-or-copy", ...(offline ? ["--offline"] : ["--prefer-offline"])]);

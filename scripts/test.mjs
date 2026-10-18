import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const tests = readdirSync(path.join(root, "tests"))
  .filter((name) => name.endsWith(".test.mjs")).sort().map((name) => `tests/${name}`);
const result = spawnSync(process.execPath, ["--test", "--experimental-strip-types", ...tests], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, CLOUDFLARE_CF_FETCH_ENABLED: "false", WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false" },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

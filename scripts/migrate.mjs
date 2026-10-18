import { spawnSync } from "node:child_process";
import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMigrations, openMigrationDatabase, preflightMigrations, projectRoot } from "./migration-tools.mjs";

export async function runMigrations({ command = "apply", persistTo = path.join(projectRoot, ".wrangler/state"), json = false } = {}) {
  if (!["apply", "preflight"].includes(command)) throw new Error("Expected apply or preflight.");
  persistTo = path.resolve(persistTo);
  await mkdir(persistTo, { recursive: true });
  const lockPath = path.join(persistTo, ".migration.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`Migration lock exists: ${lockPath}. Stop other migration runners; remove a stale lock only after verifying no runner is active.`);
    throw error;
  }
  const inspect = async (migrations) => {
    const connection = await openMigrationDatabase({ persistTo });
    try { return await preflightMigrations(connection.db, migrations); }
    finally { await connection.dispose(); }
  };
  try {
    const migrations = await loadMigrations();
    let report = await inspect(migrations);
    if (command === "apply" && report.ok) {
      // Explicitly local, noninteractive, and offline. The CLI adds the ledger
      // insertion to the same D1 transaction as each complete SQL migration.
      const result = spawnSync(process.execPath, [
        "--import", path.join(projectRoot, "scripts/sites-env.mjs"),
        path.join(projectRoot, "node_modules/wrangler/bin/wrangler.js"),
        "d1", "migrations", "apply", "DB", "--local", "--config", path.join(projectRoot, "wrangler.json"),
        "--persist-to", persistTo,
      ], {
        cwd: projectRoot,
        stdio: ["ignore", "inherit", "inherit"],
        env: { ...process.env, CI: "true", CLOUDFLARE_CF_FETCH_ENABLED: "false", WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false" },
      });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(`Wrangler migration apply failed (${result.status ?? result.signal}). Previous successful migrations remain tracked; inspect before retrying.`);
      report = await inspect(migrations);
      if (report.pending.length) throw new Error("Wrangler returned without applying all pending migrations.");
    }
    if (json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`Migration preflight: ${report.ok ? "OK" : "BLOCKED"}; ${report.applied.length} applied, ${report.pending.length} pending. State: ${persistTo}`);
      for (const issue of report.issues) console.error(`[${issue.code}] ${issue.message}\n${JSON.stringify(issue.rows)}`);
    }
    return report;
  } finally {
    await lock.close();
    await rm(lockPath);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const options = { command: args.shift() ?? "apply" };
  while (args.length) {
    const argument = args.shift();
    if (argument === "--persist-to" && args[0] && !args[0].startsWith("--")) options.persistTo = args.shift();
    else if (argument === "--json" && options.command === "preflight") options.json = true;
    else throw new Error("Usage: node scripts/migrate.mjs [apply|preflight] [--persist-to DIRECTORY] [--json (preflight only)]. Remote operations are not supported.");
  }
  if (!(await runMigrations(options)).ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

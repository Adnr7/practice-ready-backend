import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Explicit online setup check, separate from the offline test suite. Install in
// a project-owned disposable directory so parallel developers keep their modules.
const root = fileURLToPath(new URL("../", import.meta.url));
const runtime = path.join(root, ".sites-runtime");
await mkdir(runtime, { recursive: true });
const temporary = await mkdtemp(path.join(runtime, "setup-rehearsal-"));
try {
  await mkdir(path.join(temporary, "scripts"));
  for (const filename of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", ".nvmrc", "scripts/setup.mjs", "scripts/check-runtime.mjs"]) {
    await copyFile(path.join(root, filename), path.join(temporary, filename));
  }
  const lock = await readFile(path.join(temporary, "pnpm-lock.yaml"), "utf8");
  for (const args of [[], ["--offline"]]) {
    console.log(`Rehearsing clean setup${args.length ? " (offline rerun)" : ""} in a disposable project directory.`);
    const result = spawnSync(process.execPath, ["scripts/setup.mjs", ...args], {
      cwd: temporary, stdio: "inherit", timeout: 300_000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Setup rehearsal failed (${result.status ?? result.signal}).`);
    if (await readFile(path.join(temporary, "pnpm-lock.yaml"), "utf8") !== lock) throw new Error("Frozen setup changed the lockfile.");
  }
  console.log("Clean frozen setup and offline rerun passed; lockfile unchanged.");
} finally {
  await rm(temporary, { recursive: true, force: true });
}

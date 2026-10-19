import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const generatedPath = path.join(projectRoot, "dist/server/wrangler.json");
const deployPath = path.join(projectRoot, "dist/server/wrangler.deploy.json");
const rootPath = path.join(projectRoot, "wrangler.json");

const generated = JSON.parse(await readFile(generatedPath, "utf8"));
const root = JSON.parse(await readFile(rootPath, "utf8"));
const database = root.d1_databases?.find((entry) => entry.binding === "DB");

if (!generated.main) throw new Error("Generated Wrangler config is missing its Worker entrypoint.");
if (!database || database.database_name !== "practice_ready_db" || database.database_id !== "4905d07c-5c1e-45f1-8331-ee3fa78a3164") {
  throw new Error("Root Wrangler config does not contain the required Practice Ready D1 binding.");
}

const deployDatabase = { ...database, migrations_dir: "../../drizzle" };
delete deployDatabase.preview_database_id;
const deploy = {
  ...generated,
  name: "practice-ready-backend",
  d1_databases: [deployDatabase],
};
// These are local build metadata, not deployment inputs. Keeping them would
// leak this checkout's absolute path into the deploy config and make the
// generated file non-portable to a clean Linux machine.
delete deploy.configPath;
delete deploy.userConfigPath;
await writeFile(deployPath, `${JSON.stringify(deploy, null, 2)}\n`);
console.log(`Prepared ${path.relative(projectRoot, deployPath)} from generated Worker artifacts.`);

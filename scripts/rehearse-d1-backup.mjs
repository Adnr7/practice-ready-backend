import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadMigrations, openMigrationDatabase, preflightMigrations } from "./migration-tools.mjs";

const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const backup = value("--backup");
const persistTo = value("--persist-to");
if (!backup || !persistTo || args.some((arg, index) => ["--backup", "--persist-to"].includes(arg) && !args[index + 1])) {
  throw new Error("Usage: node scripts/rehearse-d1-backup.mjs --backup FILE --persist-to DIRECTORY");
}

function splitStatements(source) {
  const statements = [];
  let start = 0;
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index + 1] === quote) {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
    } else if (character === ";") {
      const statement = source.slice(start, index).trim();
      // SQLite trigger bodies contain their own semicolons. Keep collecting a
      // CREATE TRIGGER statement until its terminal END rather than handing
      // an incomplete trigger fragment to D1.
      if (/^CREATE\s+TRIGGER\b/i.test(statement) && !/\bEND\s*$/i.test(statement)) continue;
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const tail = source.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

const source = await readFile(path.resolve(backup), "utf8");
const statements = splitStatements(source).filter((statement) => {
  const normalized = statement.replace(/^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/g, "").trim();
  return normalized && !/^COMMIT$/i.test(normalized) && !/^BEGIN(?: TRANSACTION)?$/i.test(normalized);
});
const kind = (statement) => {
  const normalized = statement.replace(/^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/g, "").trim();
  if (/^PRAGMA\b/i.test(normalized)) return "pragma";
  if (/^CREATE\s+TABLE\b/i.test(normalized)) return "table";
  if (/^INSERT\s+INTO\b|^(?:DELETE|UPDATE)\s+/i.test(normalized)) return "data";
  if (/^CREATE\s+(?:UNIQUE\s+)?(?:INDEX|TRIGGER|VIEW)\b/i.test(normalized)) return "derived";
  return "other";
};
const tableStatements = [
  ...statements.filter((statement) => kind(statement) === "pragma"),
  ...statements.filter((statement) => kind(statement) === "table" && !/sqlite_sequence/i.test(statement)),
];
const dataStatements = statements.filter((statement) => kind(statement) === "data");
const derivedStatements = [
  ...statements.filter((statement) => kind(statement) === "derived"),
  ...statements.filter((statement) => kind(statement) === "other"),
];

const connection = await openMigrationDatabase({ persistTo: path.resolve(persistTo), databaseId: `backup-rehearsal-${crypto.randomUUID()}` });
try {
  await connection.db.prepare("PRAGMA foreign_keys = OFF").run();
  for (const statement of tableStatements) {
    try {
      await connection.db.prepare(statement).run();
    } catch (error) {
      throw new Error(`Backup rehearsal failed while applying ${kind(statement)} SQL: ${error.message}`);
    }
  }
  // D1 may keep foreign-key enforcement enabled even when a restored export
  // contains PRAGMA foreign_keys=OFF. Retry only FK failures until parent rows
  // have been created; every other SQL error remains fatal immediately.
  let pending = [...dataStatements];
  while (pending.length) {
    const deferred = [];
    let applied = 0;
    for (const statement of pending) {
      try {
        await connection.db.prepare(statement).run();
        applied += 1;
      } catch (error) {
        if (/FOREIGN KEY constraint failed|FOREIGNKEY/i.test(error.message)) deferred.push(statement);
        else throw new Error(`Backup rehearsal failed while applying data SQL: ${error.message}`);
      }
    }
    if (!deferred.length) break;
    if (!applied) throw new Error(`Backup rehearsal could not resolve ${deferred.length} foreign-key-dependent row(s).`);
    pending = deferred;
  }
  for (const statement of derivedStatements) {
    try {
      await connection.db.prepare(statement).run();
    } catch (error) {
      throw new Error(`Backup rehearsal failed while applying ${kind(statement)} SQL: ${error.message}`);
    }
  }
  await connection.db.prepare("PRAGMA foreign_keys = ON").run();
  const violations = await connection.db.prepare("PRAGMA foreign_key_check").all();
  if (violations.results.length) throw new Error(`Backup rehearsal found ${violations.results.length} foreign-key violation(s).`);
  const report = await preflightMigrations(connection.db, await loadMigrations());
  if (!report.ok) throw new Error(`Backup rehearsal migration preflight blocked: ${report.issues.map((issue) => issue.code).join(", ")}`);
  console.log(`Private D1 backup rehearsal passed: ${report.applied.length} migrations, ${report.pending.length} pending.`);
} finally {
  await connection.dispose();
}

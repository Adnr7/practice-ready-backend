import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb(customDb?: D1Database) {
  let dbBinding = customDb;
  if (!dbBinding) {
    try {
      dbBinding = env.DB;
    } catch {
      // In non-worker environments (e.g. CLI/tests)
    }
  }

  if (!dbBinding) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Ensure wrangler.json or .openai/hosting.json has `DB` bound to your D1 database."
    );
  }

  return drizzle(dbBinding, { schema });
}

export * from "./schema";

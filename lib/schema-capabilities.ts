export async function hasTable(db: D1Database, tableName: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .bind(tableName)
    .first<{ present: number }>();
  return Boolean(row?.present);
}

export async function hasColumn(db: D1Database, tableName: string, columnName: string): Promise<boolean> {
  const escapedTableName = tableName.replaceAll("'", "''");
  const row = await db
    .prepare(`SELECT 1 AS present FROM pragma_table_info('${escapedTableName}') WHERE name = ? LIMIT 1`)
    .bind(columnName)
    .first<{ present: number }>();
  return Boolean(row?.present);
}

export async function hasAllColumns(db: D1Database, tableName: string, columnNames: string[]): Promise<boolean> {
  if (!columnNames.length) return true;
  const escapedTableName = tableName.replaceAll("'", "''");
  const rows = await db
    .prepare(`SELECT name FROM pragma_table_info('${escapedTableName}')`)
    .all<{ name: string }>();
  const columns = new Set(rows.results.map((row) => row.name));
  return columnNames.every((columnName) => columns.has(columnName));
}

export async function hasRoomReadinessSchema(db: D1Database): Promise<boolean> {
  return (await hasAllColumns(db, "rooms", ["location_id", "readiness_state", "readiness_notes", "readiness_verified_at"]))
    && await hasTable(db, "room_restrictions")
    && await hasTable(db, "room_practice_types")
    && await hasAllColumns(db, "room_closures", ["room_id", "starts_at", "ends_at", "is_active"]);
}

export function schemaMigrationResponse(message: string, details: Record<string, unknown> = {}): Response {
  return Response.json({
    error: message,
    code: "SCHEMA_MIGRATION_REQUIRED",
    ...details,
  }, { status: 503 });
}

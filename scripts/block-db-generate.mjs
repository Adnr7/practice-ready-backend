console.error(`db:generate is unsupported: Drizzle snapshots stop at 0003, while checked-in SQL continues through 0010.
Generating from these incomplete snapshots can recreate existing tables/columns and lose constraints.
Apply existing SQL with make db-migrate. Before re-enabling generation, repair and review all snapshot metadata
against a freshly migrated D1 database, including hand-written indexes, triggers, checks and data migrations,
then prove an unchanged schema produces no migration. Do not run drizzle-kit generate directly.`);
process.exitCode = 1;

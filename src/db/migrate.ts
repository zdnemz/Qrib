// ponytail: drizzle-kit migrate runner (no framework). Upgrade to a proper
// CLI (e.g. `drizzle-kit migrate`) wrapper only if migration needs outgrow this.
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function main() {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await pool.end();
}

main().catch(async (err) => {
  console.error(JSON.stringify({ level: "error", msg: "migration failed", err: String(err) }));
  await pool.end();
  process.exit(1);
});

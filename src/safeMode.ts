// =======================================================
// 🛡️ FitAI SafeMode.ts – Database Protection Layer
// Version: 5.0 (2025-10-22)
// Author: Michal Havel & FitAI Core Team
// =======================================================
//
// ✅ Purpose:
//  - Prevent ANY destructive operation (DROP, TRUNCATE, DELETE ALL) 
//    outside of development environment.
//  - Provide audit log for blocked actions.
//  - Activate automatically in every production or staging environment.
//
// =======================================================

import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

// =======================================================
// 🧠 Global Pool – used only for audit logging
// =======================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// =======================================================
// 🧩 Helper – Write log to FoodAuditLog
// =======================================================
async function logBlockedAction(operation: string, reason: string) {
  try {
    const client = await pool.connect();
    await client.query(
      `CREATE TABLE IF NOT EXISTS "FoodAuditLog" (
        id SERIAL PRIMARY KEY,
        action TEXT,
        details JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );`
    );

    await client.query(
      `INSERT INTO "FoodAuditLog" (action, details, created_at)
       VALUES ($1, $2, NOW());`,
      [
        "BLOCKED_OPERATION",
        JSON.stringify({ operation, reason, env: process.env.MODE || "prod" }),
      ]
    );

    client.release();
  } catch (err: any) {
    console.error("⚠️ Failed to log blocked operation:", err.message);
  }
}

// =======================================================
// 🚫 Main Protection Function
// =======================================================
export async function assertSafe(operation: string) {
  const env = (process.env.MODE || process.env.NODE_ENV || "prod").toLowerCase();

  // Safe mode ON in anything except local dev
  if (env !== "dev" && env !== "development") {
    const reason = `Operation "${operation}" blocked in environment "${env}"`;
    console.log(`🚫 ${reason}`);

    await logBlockedAction(operation, reason);

    console.log(
      "🛡️ FitAI SafeMode prevented potential data loss. Exiting process..."
    );
    process.exit(0);
  }
}

// =======================================================
// 🧰 Optional Utility – confirm DB safety before continuing
// =======================================================
export async function verifyDatabaseSafety() {
  try {
    const client = await pool.connect();
    const { rows } = await client.query(
      `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';`
    );
    console.log(`📊 SafeMode Check: ${rows[0].count} tables detected.`);
    client.release();
  } catch (err: any) {
    console.error("⚠️ SafeMode DB check failed:", err.message);
  }
}

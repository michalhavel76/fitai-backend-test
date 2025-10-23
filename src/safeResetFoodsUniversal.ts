// =======================================================
// 🌍 FitAI – Safe Reset for foods_universal (Protected Version)
// Version: 5.0 (2025-10-22)
// Author: Michal Havel & FitAI Core Team
// =======================================================
//
// 🧠 Purpose:
//  - Ensure main table "foods_universal" exists with full scientific schema.
//  - Never delete, drop or reset any existing data.
//  - Log all actions for transparency (FoodAuditLog).
// =======================================================

import dotenv from "dotenv";
import { Pool } from "pg";
import { assertSafe } from "./safeMode";

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// =======================================================
// 🧾 Safe logging into FoodAuditLog
// =======================================================
async function logAction(action: string, details: any) {
  try {
    const client = await pool.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS "FoodAuditLog" (
        id SERIAL PRIMARY KEY,
        action TEXT,
        details JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(
      `INSERT INTO "FoodAuditLog" (action, details, created_at)
       VALUES ($1, $2, NOW());`,
      [action, JSON.stringify(details)]
    );

    client.release();
  } catch (err: any) {
    console.error("⚠️ Failed to write FoodAuditLog:", err.message);
  }
}

// =======================================================
// 🧩 Main Function – Safe Universal Table Check
// =======================================================
async function ensureFoodsUniversalTable() {
  console.log("🌍 Checking table 'foods_universal' integrity...");

  // 🧠 Safety Lock
  await assertSafe("resetFoodsUniversal check");

  const client = await pool.connect();

  try {
    // 1️⃣ Check if the table exists
    const exists = await client.query(`
      SELECT to_regclass('public.foods_universal') AS table_exists;
    `);
    const tableExists = !!exists.rows[0].table_exists;

    if (tableExists) {
      console.log("✅ Table 'foods_universal' already exists. No data removed.");
      await logAction("foods_universal_verified", {
        status: "exists",
        timestamp: new Date().toISOString(),
      });
    } else {
      console.log("⚙️ Table 'foods_universal' not found – creating safely...");

      await client.query(`
        CREATE TABLE IF NOT EXISTS foods_universal (
          id SERIAL PRIMARY KEY,
          name_en TEXT,
          name_cz TEXT,
          name_de TEXT,
          name_fr TEXT,
          name_es TEXT,
          name_it TEXT,
          category TEXT,
          region TEXT,
          origin TEXT,
          source TEXT,
          accuracy_score FLOAT DEFAULT 0,
          verified_by_ai BOOLEAN DEFAULT false,

          -- 42 SCIENTIFIC NUTRIENTS
          kcal FLOAT,
          protein FLOAT,
          fat FLOAT,
          carbs FLOAT,
          fiber FLOAT,
          sugar FLOAT,
          saturated_fat FLOAT,
          trans_fat FLOAT,
          cholesterol FLOAT,
          sodium FLOAT,
          potassium FLOAT,
          calcium FLOAT,
          iron FLOAT,
          magnesium FLOAT,
          phosphorus FLOAT,
          zinc FLOAT,
          copper FLOAT,
          manganese FLOAT,
          selenium FLOAT,
          iodine FLOAT,
          vitamin_a FLOAT,
          vitamin_b1 FLOAT,
          vitamin_b2 FLOAT,
          vitamin_b3 FLOAT,
          vitamin_b5 FLOAT,
          vitamin_b6 FLOAT,
          vitamin_b7 FLOAT,
          vitamin_b9 FLOAT,
          vitamin_b12 FLOAT,
          vitamin_c FLOAT,
          vitamin_d FLOAT,
          vitamin_e FLOAT,
          vitamin_k FLOAT,
          omega3 FLOAT,
          omega6 FLOAT,
          water FLOAT,
          caffeine FLOAT,
          alcohol FLOAT,
          gluten FLOAT,
          glycemic_index FLOAT,
          antioxidants FLOAT,

          -- SYSTEM FIELDS
          image_url TEXT,
          lang JSONB,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
      `);

      console.log("✅ Table 'foods_universal' created successfully (no data removed).");

      await logAction("foods_universal_created", {
        status: "created",
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err: any) {
    console.error("❌ Error ensuring 'foods_universal' table:", err.message);
    await logAction("foods_universal_error", { error: err.message });
  } finally {
    client.release();
    pool.end();
  }
}

// =======================================================
// 🚀 Run only in DEV mode (never in production)
// =======================================================
if (process.env.MODE === "dev") {
  ensureFoodsUniversalTable();
} else {
  console.log("🛡️ SafeMode: safeResetFoodsUniversal blocked (non-dev mode).");
}

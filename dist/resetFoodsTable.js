"use strict";
// =======================================================
// 🧱 FitAI – Safe Reset Table Script (Protected Version)
// Version: 5.0 (2025-10-22)
// Author: Michal Havel & FitAI Core Team
// =======================================================
//
// 🧠 Purpose:
//  - Ensure table "foods" exists with the correct schema
//  - Never delete or drop existing data
//  - Log every action safely into FoodAuditLog
// =======================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const pg_1 = require("pg");
const safeMode_1 = require("./safeMode");
dotenv_1.default.config();
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});
// =======================================================
// 🧾 Log to FoodAuditLog (for transparency)
// =======================================================
async function logAction(action, details) {
    try {
        const client = await pool.connect();
        await client.query(`CREATE TABLE IF NOT EXISTS "FoodAuditLog" (
        id SERIAL PRIMARY KEY,
        action TEXT,
        details JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );`);
        await client.query(`INSERT INTO "FoodAuditLog" (action, details, created_at)
       VALUES ($1, $2, NOW());`, [action, JSON.stringify(details)]);
        client.release();
    }
    catch (err) {
        console.error("⚠️ Failed to write FoodAuditLog:", err.message);
    }
}
// =======================================================
// 🧩 Main Function – Safe Table Check & Create
// =======================================================
async function ensureFoodsTable() {
    console.log("🧱 Checking table 'foods' integrity...");
    // 🧠 Safety Lock – stop if not dev
    await (0, safeMode_1.assertSafe)("resetFoodsTable check");
    const client = await pool.connect();
    try {
        // 1️⃣ Check if table exists
        const exists = await client.query(`
      SELECT to_regclass('public.foods') AS table_exists;
    `);
        const tableExists = !!exists.rows[0].table_exists;
        if (tableExists) {
            console.log("✅ Table 'foods' already exists. No data removed.");
            await logAction("foods_table_verified", {
                status: "exists",
                timestamp: new Date().toISOString(),
            });
        }
        else {
            console.log("⚙️  Table 'foods' not found – creating new one safely...");
            await client.query(`
        CREATE TABLE IF NOT EXISTS foods (
          id SERIAL PRIMARY KEY,
          name_en TEXT,
          name_cz TEXT,
          category TEXT,
          origin TEXT,
          kcal FLOAT,
          protein FLOAT,
          carbs FLOAT,
          fat FLOAT,
          fiber FLOAT,
          sugar FLOAT,
          sodium FLOAT,
          vitamin_a FLOAT,
          vitamin_c FLOAT,
          calcium FLOAT,
          iron FLOAT,
          source TEXT,
          image_url TEXT,
          lang JSONB,
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);
            console.log("✅ Table 'foods' created successfully (no data removed).");
            await logAction("foods_table_created", {
                status: "created",
                timestamp: new Date().toISOString(),
            });
        }
    }
    catch (err) {
        console.error("❌ Error ensuring 'foods' table:", err.message);
        await logAction("foods_table_error", { error: err.message });
    }
    finally {
        client.release();
        pool.end();
    }
}
// =======================================================
// 🚀 Execute only if explicitly run by developer
// =======================================================
if (process.env.MODE === "dev") {
    ensureFoodsTable();
}
else {
    console.log("🛡️ SafeMode: resetFoodsTable blocked (non-dev mode).");
}

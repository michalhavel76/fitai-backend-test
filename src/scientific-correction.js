// =======================================================
// FitAI 4.8 – Scientific Correction Engine (Auto-Compatible)
// Works with: import scientificCorrection from "./scientific-correction";
// Full Production Version – 2025-10-19
// =======================================================

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// =======================================================
// 🧱 AUTO DB CHECK (creates audit log table if missing)
// =======================================================
async function ensureAuditLog(client) {
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS food_audit_log (
        id SERIAL PRIMARY KEY,
        food_id INT,
        action TEXT,
        details JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log("🧩 food_audit_log verified");
  } catch (err) {
    console.error("❌ DB structure check failed:", err.message);
  }
}

// =======================================================
// ⚙️ SAFE LIMITS (scientific boundaries per 100g)
// =======================================================
const LIMITS = {
  kcal: [0, 950],
  protein: [0, 100],
  fat: [0, 100],
  carbs: [0, 100],
};

// =======================================================
// 🧮 HELPERS
// =======================================================
const clamp = (v, [min, max]) =>
  v == null || isNaN(v) ? 0 : Math.min(Math.max(v, min), max);

const normalize = (v) =>
  Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

function fixUnits(v) {
  if (v > 900) return normalize(v / 10);
  if (v > 90) return normalize(v / 10);
  return normalize(v);
}

// =======================================================
// 🧬 MAIN ENGINE
// =======================================================
const scientificCorrection = async (req, res) => {
  console.log("🧪 Running FitAI Scientific Correction 4.8...");
  const client = await pool.connect();

  try {
    await ensureAuditLog(client);

    const allFoods = await client.query("SELECT * FROM foods ORDER BY id ASC");
    const total = allFoods.rows.length;

    let corrected = 0;
    let anomalies = 0;

    for (const f of allFoods.rows) {
      let { id, kcal, protein, fat, carbs } = f;

      // 1️⃣ Remove invalids
      kcal = Math.max(0, Number(kcal) || 0);
      protein = Math.max(0, Number(protein) || 0);
      fat = Math.max(0, Number(fat) || 0);
      carbs = Math.max(0, Number(carbs) || 0);

      // 2️⃣ Clamp to safe limits
      kcal = clamp(kcal, LIMITS.kcal);
      protein = clamp(protein, LIMITS.protein);
      fat = clamp(fat, LIMITS.fat);
      carbs = clamp(carbs, LIMITS.carbs);

      // 3️⃣ Fix likely unit errors
      kcal = fixUnits(kcal);
      protein = fixUnits(protein);
      fat = fixUnits(fat);
      carbs = fixUnits(carbs);

      // 4️⃣ Adjust kcal if mismatch with macros
      const calcKcal = normalize(protein * 4 + carbs * 4 + fat * 9);
      if (Math.abs(calcKcal - kcal) > 80) {
        kcal = calcKcal;
        anomalies++;
      }

      // 5️⃣ Update food record
      await client.query(
        `UPDATE foods 
         SET kcal=$1, protein=$2, fat=$3, carbs=$4, updated_at=NOW()
         WHERE id=$5`,
        [kcal, protein, fat, carbs, id]
      );

      // 6️⃣ Log correction
      await client.query(
        `INSERT INTO food_audit_log (food_id, action, details, created_at)
         VALUES ($1,$2,$3,NOW())`,
        [
          id,
          "scientific_correction",
          JSON.stringify({
            kcal,
            protein,
            fat,
            carbs,
            autoRecalc: calcKcal,
          }),
        ]
      );

      corrected++;
    }

    const summary = {
      totalFoods: total,
      corrected,
      anomalies,
      successRate: total ? Number((corrected / total).toFixed(2)) : 0,
      message: "Scientific correction completed successfully",
      date: new Date().toISOString(),
    };

    console.log("✅ Scientific correction finished:", summary);
    res.json(summary);
  } catch (err) {
    console.error("❌ Scientific correction error:", err);
    res.status(500).json({ error: "Scientific correction failed" });
  } finally {
    client.release();
  }
};

// =======================================================
// ✅ DEFAULT EXPORT (compatible with existing index.ts)
// =======================================================
export default scientificCorrection;

// =======================================================
// 🧬 FitAI Manual Fill 42 – Safe scientific nutrient update
// Version 5.0
// =======================================================

import express from "express";
import { Pool } from "pg";
import { assertSafe } from "./safeMode";

const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// =======================================================
// 🧠 API endpoint: POST /api/manual-fill-42
// =======================================================
router.post("/api/manual-fill-42", async (req, res) => {
  await assertSafe("manual scientific fill");

  const client = await pool.connect();
  const foods = req.body.foods || [];

  if (!Array.isArray(foods) || foods.length === 0) {
    return res.status(400).json({ error: "Missing food data" });
  }

  try {
    for (const f of foods) {
      await client.query(
        `UPDATE foods
         SET
           kcal=$1, protein=$2, fat=$3, carbs=$4,
           fiber=$5, sugar=$6, sodium=$7, potassium=$8,
           calcium=$9, iron=$10, magnesium=$11, phosphorus=$12,
           zinc=$13, copper=$14, selenium=$15, vitamin_a=$16,
           vitamin_b2=$17, vitamin_b12=$18, vitamin_d=$19,
           water=$20, glycemic_index=$21,
           verified_by_ai=true, accuracy_score=$22, updated_at=NOW()
         WHERE LOWER(name_en) LIKE $23;`,
        [
          f.kcal, f.protein, f.fat, f.carbs, f.fiber, f.sugar, f.sodium, f.potassium,
          f.calcium, f.iron, f.magnesium, f.phosphorus, f.zinc, f.copper, f.selenium,
          f.vitamin_a, f.vitamin_b2, f.vitamin_b12, f.vitamin_d,
          f.water, f.glycemic_index, f.accuracy_score, `%${f.name_en.toLowerCase()}%`
        ]
      );
    }

    res.json({
      success: true,
      updated: foods.length,
      message: "Manual fill completed successfully.",
    });
  } catch (err: any) {
    console.error("❌ Manual fill error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;

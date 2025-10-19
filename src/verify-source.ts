// =======================================================
// FitAI 4.4 – Verify Source Accuracy (USDA Comparison)
// =======================================================

import express from "express";
import axios from "axios";
import { Pool } from "pg";

const router = express.Router();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

router.post("/api/verify-source", async (req, res) => {
  try {
    const { food } = req.body;
    if (!food) return res.status(400).json({ error: "Missing food name" });

    // 1️⃣ Najdi food v DB
    const dbFood = await pool.query(
      "SELECT * FROM foods WHERE LOWER(name_en) = LOWER($1) LIMIT 1",
      [food]
    );
    if (dbFood.rows.length === 0)
      return res.status(404).json({ error: "Food not found in DB" });

    const local = dbFood.rows[0];

    // 2️⃣ USDA vyhledávání
    const USDA_API_KEY = "CoapVie1RnpUCrfGNfbeoDyG0Ut3DNktWOyLnUC0";
    const searchRes = await axios.get(
      "https://api.nal.usda.gov/fdc/v1/foods/search",
      { params: { api_key: USDA_API_KEY, query: food, pageSize: 1 } }
    );

    const foods = searchRes.data.foods || [];
    if (foods.length === 0)
      return res.status(404).json({ error: "No USDA match found" });

    const fdcId = foods[0].fdcId;
    const foodRes = await axios.get(
      `https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${USDA_API_KEY}`
    );
    const usda = foodRes.data;

    // 3️⃣ Extrakce základních makroživin
    const extract = (name: string) => {
      const match = usda.foodNutrients?.find((n: any) =>
        n.nutrient?.name?.toLowerCase().includes(name)
      );
      return match ? match.amount : null;
    };

    const ref = {
      kcal: extract("energy"),
      protein: extract("protein"),
      fat: extract("total lipid"),
      carbs: extract("carbohydrate"),
    };

    // 4️⃣ Porovnání shody
    const diff = (a: number, b: number) =>
      a && b ? (100 - Math.abs((a - b) / a) * 100).toFixed(2) + "%" : "N/A";

    const comparison = {
      kcal_match: diff(ref.kcal, local.kcal),
      protein_match: diff(ref.protein, local.protein),
      fat_match: diff(ref.fat, local.fat),
      carbs_match: diff(ref.carbs, local.carbs),
    };

    res.json({
      food: local.name_en,
      local_values: {
        kcal: local.kcal,
        protein: local.protein,
        fat: local.fat,
        carbs: local.carbs,
      },
      usda_values: ref,
      comparison,
    });
  } catch (err: any) {
    console.error("Verify error:", err.message);
    res.status(500).json({ error: "Verification failed" });
  }
});

export default router;

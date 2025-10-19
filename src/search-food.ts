// =======================================================
// FitAI 4.4 – Search Food (DB Query Helper)
// =======================================================

import express from "express";
import { Pool } from "pg";

const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// 🔍 Find foods by name (EN or CZ)
router.post("/api/search-food", async (req, res) => {
  try {
    const { food } = req.body;
    if (!food) return res.status(400).json({ error: "Missing food name" });

    const result = await pool.query(
      `SELECT id, name_en, name_cz, kcal, protein, fat, carbs, updated_at
       FROM foods
       WHERE LOWER(name_en) LIKE LOWER($1)
          OR LOWER(name_cz) LIKE LOWER($1)
       ORDER BY id ASC
       LIMIT 10`,
      [`%${food}%`]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ message: "No foods found" });

    res.json({ count: result.rows.length, results: result.rows });
  } catch (err: any) {
    console.error("Search error:", err.message);
    res.status(500).json({ error: "Search failed" });
  }
});

export default router;

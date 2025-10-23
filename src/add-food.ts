// =======================================================
// FitAI 5.0.1 – /api/add-food
// ✅ Uses global Prisma instance (no double init)
// =======================================================

import express from "express";
import { prisma } from "./index"; // 👈 vezmeme existující instanci, ne novou!

const router = express.Router();

// =======================================================
// 🍎 POST /api/add-food
// =======================================================
router.post("/api/add-food", async (req, res) => {
  try {
    const { name_en, category, kcal, protein, carbs, fat } = req.body;

    if (!name_en) {
      return res.status(400).json({ error: "Missing food name" });
    }

    const food = await prisma.foods.create({
      data: {
        name_en,
        name_cz: name_en,
        category: category || "other",
        kcal: kcal || 0,
        protein: protein || 0,
        carbs: carbs || 0,
        fat: fat || 0,
        source: "FitAI_App_Insert",
      },
    });

    console.log(`✅ Inserted new food → ${food.name_en}`);

    res.json({
      status: "success",
      food: food.name_en,
      id: food.id,
    });
  } catch (err: any) {
    console.error("❌ Add-food error:", err.message);
    res.status(500).json({
      status: "error",
      message: err.message || "Internal Server Error",
    });
  }
});

export default router;

// =======================================================
// FitAI 5.0 – /api/add-food
// ✅ Insert food to Railway PostgreSQL (no robot mode)
// =======================================================

import express from "express";
import { PrismaClient } from "@prisma/client";

const router = express.Router();
const prisma = new PrismaClient();

router.post("/add-food", async (req, res) => {
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

    console.log(`✅ [FitAI] Inserted new food → ${food.name_en}`);

    return res.json({
      status: "success",
      food: food.name_en,
      id: food.id,
    });
  } catch (err: any) {
    console.error("❌ Add-food error:", err.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;

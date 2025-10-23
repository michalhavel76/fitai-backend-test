// =======================================================
// FitAI 5.0 – /api/add-food
// ✅ Safe Railway insert + Prisma lazy init + clean logging
// =======================================================

import express from "express";
import { PrismaClient } from "@prisma/client";

const router = express.Router();

// ✅ Lazy Prisma init (Railway-safe)
let prisma: PrismaClient | null = null;
async function getPrisma() {
  if (!prisma) {
    prisma = new PrismaClient();
    await prisma.$connect();
  }
  return prisma;
}

// =======================================================
// 🧠 Endpoint: POST /api/add-food
// =======================================================
router.post("/api/add-food", async (req, res) => {
  try {
    const { name_en, category, kcal, protein, carbs, fat } = req.body;
    if (!name_en) {
      return res.status(400).json({ error: "Missing food name" });
    }

    const db = await getPrisma();

    const food = await db.foods.create({
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
    return res.status(500).json({
      status: "error",
      message: err.message || "Internal Server Error",
    });
  }
});

export default router;

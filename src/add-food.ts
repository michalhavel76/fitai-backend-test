// =======================================================
// FitAI 5.0.2 – /api/add-food (Legacy Stable 19.10 version)
// ✅ Works on Railway – auto connect + auto disconnect
// =======================================================

import express from "express";
import { PrismaClient } from "@prisma/client";

const router = express.Router();

// =======================================================
// 🍎 POST /api/add-food
// =======================================================
router.post("/api/add-food", async (req, res) => {
  const prisma = new PrismaClient(); // ⚙️ vždy nový klient (Railway-safe)
  try {
    const { name_en, category, kcal, protein, carbs, fat } = req.body;

    if (!name_en) {
      return res.status(400).json({ error: "Missing food name" });
    }

    await prisma.$connect(); // ✅ jistota připojení

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

    console.log(`✅ [FitAI] Inserted → ${food.name_en}`);

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
  } finally {
    await prisma.$disconnect(); // 🧹 důležité – zavře DB spojení po každém requestu
  }
});

export default router;

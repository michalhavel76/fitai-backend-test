// =======================================================
// FitAI 4.9.5 – Add Food (Safe Mode for Railway)
// ✅ Stable minimal insert – no nested imports or loops
// =======================================================

import express from "express";
import { PrismaClient } from "@prisma/client";

const router = express.Router();
const prisma = new PrismaClient();

// =======================================================
// 🧠 /api/add-food – vloží jídlo do Railway DB (bez dalších modulů)
// =======================================================
router.post("/api/add-food", async (req, res) => {
  try {
    const { name_en, category, kcal, protein, carbs, fat } = req.body;

    if (!name_en) {
      return res.status(400).json({ error: "Missing food name" });
    }

    // 1️⃣ Vytvoř nebo aktualizuj položku
    const existing = await prisma.foods.findFirst({
      where: { name_en: name_en.toLowerCase() },
    });

    let food;
    if (existing) {
      food = await prisma.foods.update({
        where: { id: existing.id },
        data: {
          category: category || existing.category || "other",
          kcal: kcal ?? existing.kcal ?? 0,
          protein: protein ?? existing.protein ?? 0,
          carbs: carbs ?? existing.carbs ?? 0,
          fat: fat ?? existing.fat ?? 0,
          updated_at: new Date(),
        },
      });
      console.log(`♻️ Updated food: ${food.name_en}`);
    } else {
      food = await prisma.foods.create({
        data: {
          name_en: name_en.toLowerCase(),
          name_cz: name_en,
          category: category || "other",
          kcal: kcal || 0,
          protein: protein || 0,
          carbs: carbs || 0,
          fat: fat || 0,
          source: "FitAI_SafeMode",
        },
      });
      console.log(`✅ Inserted new food: ${food.name_en}`);
    }

    // 2️⃣ Okamžitá odpověď (žádné další volání)
    return res.json({
      status: "success",
      message: "Food inserted successfully (Safe Mode)",
      food,
    });
  } catch (err: any) {
    console.error("❌ Add-food error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;

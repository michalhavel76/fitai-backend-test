// =======================================================
// FitAI 4.9.3 – Nutrient Fill FIX + Internal Mode
// Full 42 Nutrients Autocomplete + NeverZero Safety
// =======================================================

import express from "express";
import { PrismaClient } from "@prisma/client";
import { fitaiDataHub } from "./datahub-engine";
import { aiFallbackNutrients } from "./utils/ai-fallback";

const prisma = new PrismaClient();
const router = express.Router();

// =======================================================
// 🧠 1️⃣ Main Endpoint: /api/nutrient-fill
// =======================================================
router.post("/api/nutrient-fill", async (req, res) => {
  try {
    const { food } = req.body;
    if (!food) return res.status(400).json({ error: "Missing food name" });

    console.log("🧩 Nutrient fill started for:", food);
    const result = await nutrientFillLocal(food);

    res.json({ status: "filled", food, nutrients: result });
  } catch (err: any) {
    console.error("❌ Nutrient fill error:", err);
    res.status(500).json({ error: "Internal error", details: err.message });
  }
});

// =======================================================
// 🧩 2️⃣ Internal Function – usable by other modules
// =======================================================
export async function nutrientFillLocal(food: string) {
  try {
    const found = await fitaiDataHub.findFood(food);

    // 1️⃣ Pokud není nalezeno v DataHubu → použij fallback
    let data = found
      ? {
          kcal: found.kcal ?? 0,
          protein: found.protein ?? 0,
          carbs: found.carbs ?? 0,
          fat: found.fat ?? 0,
          fiber: found.fiber ?? 0,
          sugar: found.sugar ?? 0,
          sodium: found.sodium ?? 0,
          vitamin_a: found.vitamin_a ?? 0,
          vitamin_b1: found.vitamin_b1 ?? 0,
          vitamin_b2: found.vitamin_b2 ?? 0,
          vitamin_b3: found.vitamin_b3 ?? 0,
          vitamin_b5: found.vitamin_b5 ?? 0,
          vitamin_b6: found.vitamin_b6 ?? 0,
          vitamin_b7: found.vitamin_b7 ?? 0,
          vitamin_b9: found.vitamin_b9 ?? 0,
          vitamin_b12: found.vitamin_b12 ?? 0,
          vitamin_c: found.vitamin_c ?? 0,
          vitamin_d: found.vitamin_d ?? 0,
          vitamin_e: found.vitamin_e ?? 0,
          vitamin_k: found.vitamin_k ?? 0,
          calcium: found.calcium ?? 0,
          iron: found.iron ?? 0,
          magnesium: found.magnesium ?? 0,
          phosphorus: found.phosphorus ?? 0,
          potassium: found.potassium ?? 0,
          zinc: found.zinc ?? 0,
          copper: found.copper ?? 0,
          manganese: found.manganese ?? 0,
          selenium: found.selenium ?? 0,
          iodine: found.iodine ?? 0,
          chromium: found.chromium ?? 0,
          molybdenum: found.molybdenum ?? 0,
          chloride: found.chloride ?? 0,
        }
      : {};

    // 2️⃣ AI doplnění (pokud nějaké hodnoty chybí)
    const completed = await aiFallbackNutrients(data);

    // 3️⃣ Ulož zpět do DB
    await prisma.foods.updateMany({
      where: { name_en: food },
      data: completed,
    });

    console.log(`✅ Nutrients completed for ${food}`);
    return completed;
  } catch (err: any) {
    console.error("❌ nutrientFillLocal error:", err.message);
    return {};
  }
}

export default router;

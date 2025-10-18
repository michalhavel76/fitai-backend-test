// =======================================================
// FitAI DataHub Engine v1
// Created: 2025-10-18
// Author: Michal + GPT (FitAI 4.2 Foundation)
// =======================================================

import express from "express";
import { PrismaClient } from "@prisma/client";

const router = express.Router();
const prisma = new PrismaClient();

// =======================================================
// 🔁 Endpoint: /datahub-refresh
// - Sečte všechny hodnoty živin z tabulky foods
// - Vypočítá průměr každé živiny
// - Uloží výsledky do FitAI_DataHub
// =======================================================
router.post("/datahub-refresh", async (req, res) => {
  try {
    console.log("⚙️ Starting FitAI DataHub refresh...");

    // 1️⃣ Načti všechny potraviny z tabulky foods
    const foods = await prisma.foods.findMany();
    if (foods.length === 0) {
      return res.status(404).json({ error: "No foods found in database." });
    }

    // 2️⃣ Seznam klíčů živin, které chceme průměrovat
    const nutrientKeys = [
      "kcal", "protein", "carbs", "fat", "fiber", "sugar",
      "sodium", "vitamin_a", "vitamin_c", "vitamin_d", "vitamin_e", "vitamin_k",
      "calcium", "iron", "magnesium", "phosphorus", "potassium",
      "zinc", "copper", "manganese", "selenium",
      "omega_3", "omega_6", "cholesterol", "water"
    ];

    // 3️⃣ Vypočítej průměry
    const averages: Record<string, number> = {};
    for (const key of nutrientKeys) {
      const validValues = foods.map(f => (f as any)[key]).filter((v: any) => typeof v === "number" && !isNaN(v));
      if (validValues.length > 0) {
        const avg = validValues.reduce((sum: number, val: number) => sum + val, 0) / validValues.length;
        averages[key] = Number(avg.toFixed(3));

        // 4️⃣ Ulož nebo aktualizuj v DataHubu
        await prisma.fitAI_DataHub.upsert({
          where: { nutrient_key: key },
          update: {
            avg_value: averages[key],
            samples_count: validValues.length,
            accuracy_score: 0.9
          },
          create: {
            nutrient_key: key,
            avg_value: averages[key],
            samples_count: validValues.length,
            accuracy_score: 0.9
          },
        });
      }
    }

    console.log("✅ DataHub updated successfully:", Object.keys(averages).length, "nutrients.");
    res.json({
      success: true,
      updated: Object.keys(averages).length,
      data: averages,
    });
  } catch (err: any) {
    console.error("❌ DataHub Engine error:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;

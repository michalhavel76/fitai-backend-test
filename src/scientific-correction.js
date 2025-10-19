// ============================================================
// FitAI 4.7 – Scientific Correction Pro
// Advanced validation of 100 g nutrition values
// ============================================================

import express from "express";
import { PrismaClient } from "@prisma/client";

const router = express.Router();
const prisma = new PrismaClient();

// ✅ Vědecké kcal rozsahy podle kategorií (na 100 g)
const kcalRanges = {
  vegetable: [15, 90],
  fruit: [20, 100],
  meat: [80, 300],
  fish: [70, 280],
  bread: [200, 500],
  cereal: [250, 500],
  dairy: [40, 200],
  fat: [500, 900],
  starch: [100, 400],
  sweet: [300, 550],
};

// ✅ Přesnější detekce kategorie podle názvu
function detectCategory(name) {
  const n = (name || "").toLowerCase();

  if (n.includes("salmon") || n.includes("cod") || n.includes("fish")) return "fish";
  if (n.includes("chicken") || n.includes("meat") || n.includes("beef")) return "meat";
  if (n.includes("bread") || n.includes("bun") || n.includes("roll")) return "bread";
  if (n.includes("rice") || n.includes("pasta") || n.includes("noodle")) return "starch";
  if (n.includes("potato") || n.includes("fries")) return "starch";
  if (n.includes("milk") || n.includes("cheese") || n.includes("yogurt")) return "dairy";
  if (n.includes("apple") || n.includes("banana") || n.includes("fruit")) return "fruit";
  if (n.includes("avocado") || n.includes("nut") || n.includes("peanut") || n.includes("butter") || n.includes("oil")) return "fat";
  if (n.includes("chocolate") || n.includes("cake") || n.includes("snicker")) return "sweet";
  if (n.includes("tomato") || n.includes("lettuce") || n.includes("onion") || n.includes("herb") || n.includes("cucumber") || n.includes("carrot")) return "vegetable";

  return "vegetable";
}

// ============================================================
// 🧠 Route: /api/scientific-correct
// ============================================================
router.post("/api/scientific-correct", async (req, res) => {
  try {
    const limit = Number(req.body.limit) || 50;
    const foods = await prisma.foods.findMany({ take: limit });

    let updated = 0;
    const logs = [];
    const factors = [];

    for (const food of foods) {
      const category = detectCategory(food.name_en || "");
      const [min, max] = kcalRanges[category] || [20, 400];
      const kcal = Number(food.kcal) || 0;

      if (kcal <= 0) continue;

      const tooLow = kcal < min * 0.7;
      const tooHigh = kcal > max * 1.3;

      if (tooLow || tooHigh) {
        const target = (min + max) / 2;
        const factor = target / kcal;
        factors.push(factor);

        const updatedValues = {
          kcal: target,
          protein: (food.protein || 0) * factor,
          carbs: (food.carbs || 0) * factor,
          fat: (food.fat || 0) * factor,
          accuracy_score: Math.min(1.0, (food.accuracy_score || 0.8) + 0.1),
          updated_at: new Date(),
        };

        await prisma.foods.update({
          where: { id: food.id },
          data: updatedValues,
        });

        await prisma.foodAuditLog.create({
          data: {
            food_id: food.id,
            changed_fields: updatedValues,
            source_chain: { source: "Scientific Correction Engine 4.7 Pro" },
            reliability_score: 0.98,
          },
        });

        updated++;
        logs.push({
          id: food.id,
          food: food.name_en,
          category,
          issue: tooLow ? "too low" : "too high",
          factor: factor.toFixed(3),
          kcal_before: kcal,
          kcal_after: target,
        });

        console.log(
          `✅ [Scientific fix] ${food.name_en} (${category}) → ${target} kcal`
        );
      }
    }

    // 📊 Vědecké souhrny
    const meanFactor =
      factors.length > 0
        ? factors.reduce((a, b) => a + b, 0) / factors.length
        : 1;

    const deviation =
      factors.length > 0
        ? Math.sqrt(
            factors.reduce((a, b) => a + Math.pow(b - meanFactor, 2), 0) /
              factors.length
          )
        : 0;

    const overallAccuracy = Math.min(
      100,
      100 - Math.abs(meanFactor - 1) * 100 - deviation * 10
    );

    res.json({
      success: true,
      updated,
      meanCorrectionFactor: meanFactor.toFixed(3),
      deviation: deviation.toFixed(3),
      overallScientificAccuracy: overallAccuracy.toFixed(2),
      logs,
      message: `Scientific correction Pro completed for ${updated} foods.`,
    });
  } catch (err) {
    console.error("❌ Scientific correction error:", err.message);
    res.status(500).json({ error: "Scientific correction failed" });
  }
});

export default router;

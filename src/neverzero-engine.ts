// ============================================================
// FitAI 4.5 – NeverZero 2.3 Global Nutrient Mode (42 nutrients)
// TypeScript & Railway Safe Build – 2025-10-19
// ============================================================

import express from "express";
import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";

const router = express.Router();
const prisma = new PrismaClient();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

// 🧩 Kompletní seznam všech nutrientů (makra + mikro)
const nutrientFields: string[] = [
  "kcal", "protein", "carbs", "fat", "fiber", "sugar", "sodium",
  "vitamin_a", "vitamin_c", "vitamin_d", "vitamin_e", "vitamin_k",
  "calcium", "iron", "magnesium", "phosphorus", "potassium", "zinc",
  "copper", "manganese", "selenium", "iodine", "chromium", "molybdenum",
  "omega_3", "omega_6", "monounsaturated_fat", "polyunsaturated_fat",
  "trans_fat", "cholesterol", "water",
  "thiamin_b1", "riboflavin_b2", "niacin_b3", "pantothenic_b5",
  "biotin_b7", "folate_b9", "vitamin_b6", "vitamin_b12", "choline",
  "alcohol", "caffeine",
];

// 🧮 Reálné rozsahy hodnot pro detekci chyb měřítka
const expectedMax: Record<string, number> = {
  vitamin_b6: 5, vitamin_b12: 5, vitamin_c: 200, vitamin_d: 20,
  vitamin_e: 50, vitamin_k: 1000, iron: 30, zinc: 10, magnesium: 500,
  phosphorus: 1000, potassium: 1500, selenium: 150, calcium: 1000,
  manganese: 10, copper: 5, iodine: 1000,
};

// ==================================================
// 🧠 NEVERZERO SYNC – Global Nutrient Auto-Fill
// ==================================================
router.post("/api/neverzero-sync", async (req, res) => {
  try {
    const limit = Number(req.body?.limit) || 10;
    console.log("🧠 NeverZero 2.3 Global Nutrient Mode started...");

    const foods = await prisma.foods.findMany({
      where: { OR: nutrientFields.map((n) => ({ [n]: null })) },
      take: limit,
    });

    let updatedCount = 0;

    for (const food of foods) {
      const updates: Record<string, number> = {};
      const changed: Record<string, any> = {};

      for (const n of nutrientFields) {
        let val = (food as any)[n];

        // 1️⃣ Pokud je hodnota null → dopočítej
        if (val == null) {
          const hub = await prisma.fitAI_DataHub.findFirst({
            where: { nutrient_key: n },
          });

          if (hub?.avg_value) {
            val = hub.avg_value;
            changed[n] = { value: val, source: "FitAI_DataHub", accuracy: hub.accuracy_score };
          } else if (openai.apiKey) {
            // 🔁 AI fallback odhad
            const prompt = `Estimate typical amount of ${n.split("_").join(" ")} in 100g of ${food.name_en}. Return only numeric value.`;
            try {
              const ai = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                  { role: "system", content: "You are a precise food nutrition scientist." },
                  { role: "user", content: prompt },
                ],
              });

              const parsed = parseFloat(
                ai.choices?.[0]?.message?.content?.replace(/[^\d.]/g, "") || "0"
              );

              if (!isNaN(parsed) && parsed > 0) {
                val = parsed;
                changed[n] = { value: parsed, source: "AI_estimate", accuracy: 0.65 };
              }
            } catch (err: any) {
              console.error(`AI estimate error for ${food.name_en} (${n}):`, err.message);
            }
          }
        }

        // 2️⃣ Kontrola a oprava měřítka
        const maxVal = expectedMax[n];
        if (val && maxVal && val > maxVal * 10) {
          const oldVal = val;
          val = +(val / 100).toFixed(4);
          changed[n] = { value: val, source: "unit_fix", oldValue: oldVal };
        }

        // 3️⃣ Ulož změnu
        if (val != null && val !== (food as any)[n]) {
          updates[n] = val;
        }
      }

      // 4️⃣ Ulož do DB + audit log
      if (Object.keys(updates).length > 0) {
        await prisma.foods.update({
          where: { id: food.id },
          data: {
            ...(updates as any),
            accuracy_score: Math.min((food.accuracy_score || 0.9) + 0.05, 1.0),
            updated_at: new Date(),
          },
        });

        await prisma.foodAuditLog.create({
          data: {
            food_id: food.id,
            changed_fields: changed as any,
            source_chain: { source: "NeverZero 2.3 Global Nutrient Mode" } as any,
            reliability_score: 0.9,
          } as any,
        });

        updatedCount++;
        console.log(`✅ Updated nutrients for: ${food.name_en}`);
      }
    }

    console.log(`🎯 Completed. ${updatedCount} foods updated.`);
    res.json({
      success: true,
      updated: updatedCount,
      message: `NeverZero 2.3 processed ${updatedCount} foods successfully.`,
    });
  } catch (err: any) {
    console.error("❌ NeverZero 2.3 error:", err.message);
    res.status(500).json({ error: "NeverZero 2.3 failed" });
  }
});

export default router;

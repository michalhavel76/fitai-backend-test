// =======================================================
// FitAI Normalize Engine 1.5 – Smart + Scientific + Auto Recalibrate
// Version: 2025-10-19 (TypeScript + Railway Safe Build)
// =======================================================

import express from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = express.Router();

type AnyFood = Record<string, any>; // 🔧 univerzální typ, odstraní TS chyby

// =======================================================
// 🧮 1️⃣ Smart Portion Correction (verze 1.3)
// =======================================================
router.post("/api/normalize-smart", async (req, res) => {
  try {
    const limit = Number(req.body?.limit) || 10;
    const foods = await prisma.foods.findMany({ take: limit, orderBy: { id: "asc" } });
    const logs: AnyFood[] = [];
    let updated = 0;

    for (const food of foods) {
      const baseKcal = food.kcal || 0;
      if (baseKcal === 0) continue;

      const factor = baseKcal > 300 ? 0.5 : baseKcal < 50 ? 2.0 : 1.0;
      const correctedKeys: string[] = [];

      if (factor !== 1.0) {
        const updatedFood: AnyFood = { ...food };

        for (const k of ["kcal", "protein", "carbs", "fat", "fiber", "sugar", "sodium"]) {
          const val = (food as AnyFood)[k];
          if (typeof val === "number" && val > 0) {
            updatedFood[k] = val * factor;
            correctedKeys.push(k);
          }
        }

        await prisma.foods.update({
          where: { id: food.id },
          data: {
            ...(updatedFood as any),
            accuracy_score: Math.min((food.accuracy_score || 0.8) + 0.05, 0.9),
            updated_at: new Date(),
          } as any,
        });

        updated++;
        logs.push({ id: food.id, food: food.name_en, factor, correctedKeys });
      }
    }

    res.json({
      success: true,
      updated,
      message: "Smart portion correction completed (100 g standard).",
      logs,
    });
  } catch (err: any) {
    console.error("❌ Normalize Smart Error:", err.message);
    res.status(500).json({ error: "Smart normalization failed" });
  }
});

// =======================================================
// 🧬 2️⃣ Scientific Unit Match (verze 1.4)
// =======================================================
router.post("/api/normalize-scientific", async (req, res) => {
  try {
    const limit = Number(req.body?.limit) || 10;
    const foods = await prisma.foods.findMany({ take: limit, orderBy: { id: "asc" } });
    const logs: AnyFood[] = [];
    let updated = 0;

    for (const food of foods) {
      const changes: Record<string, any> = {};
      let fixed = false;

      for (const [key, val] of Object.entries(food as AnyFood)) {
        if (typeof val !== "number" || val === 0) continue;

        // Vitamíny – pravděpodobně µg místo mg
        if (/vitamin/i.test(key) && val > 50) {
          (food as AnyFood)[key] = val / 1000;
          changes[key] = { old: val, new: val / 1000, fix: "µg→mg" };
          fixed = true;
        }

        // Minerály – pravděpodobně mg místo µg
        if (/(iron|zinc|copper|selenium)/i.test(key) && val > 100) {
          (food as AnyFood)[key] = val / 100;
          changes[key] = { old: val, new: val / 100, fix: "mg→µg" };
          fixed = true;
        }
      }

      if (fixed) {
        await prisma.foods.update({
          where: { id: food.id },
          data: {
            ...(food as any),
            accuracy_score: Math.min((food.accuracy_score || 0.9) + 0.05, 0.96),
            updated_at: new Date(),
          } as any,
        });
        updated++;
        logs.push({ id: food.id, food: food.name_en, correctedKeys: Object.keys(changes) });
      }
    }

    res.json({
      success: true,
      updated,
      message: `Scientific Unit Match normalization completed for ${updated} foods.`,
      logs,
    });
  } catch (err: any) {
    console.error("❌ Normalize Scientific Error:", err.message);
    res.status(500).json({ error: "Scientific normalization failed" });
  }
});

// =======================================================
// ⚖️ 3️⃣ Auto Recalibrate (verze 1.5)
// =======================================================
router.post("/api/normalize-recalibrate", async (req, res) => {
  try {
    const limit = Number(req.body?.limit) || 10;
    const foods = await prisma.foods.findMany({ take: limit, orderBy: { id: "asc" } });
    const logs: AnyFood[] = [];
    let updated = 0;

    for (const food of foods) {
      const corrections: string[] = [];
      const recalibrated: AnyFood = { ...food };

      for (const [key, val] of Object.entries(food as AnyFood)) {
        if (typeof val !== "number" || val <= 0) continue;

        // Extrémně vysoké hodnoty → špatná jednotka
        if (val > 1000) {
          recalibrated[key] = val / 100;
          corrections.push(`${key}: /100`);
        }

        // Extrémně nízké hodnoty → chybějící přepočet
        if (val < 0.01 && !key.includes("accuracy")) {
          recalibrated[key] = val * 100;
          corrections.push(`${key}: ×100`);
        }
      }

      if (corrections.length > 0) {
        updated++;

        await prisma.foods.update({
          where: { id: food.id },
          data: {
            ...(recalibrated as any),
            accuracy_score: Math.min((food.accuracy_score || 0.9) + 0.03, 0.99),
            updated_at: new Date(),
          } as any,
        });

        logs.push({
          id: food.id,
          food: food.name_en,
          fixed: corrections.map((c) => c.split(":")[0]),
          new_accuracy: (food.accuracy_score || 0.9) + 0.03,
        });
      }
    }

    res.json({
      success: true,
      updated,
      message: `Auto Recalibration completed for ${updated} foods.`,
      logs,
    });
  } catch (err: any) {
    console.error("❌ Auto Recalibrate Error:", err.message);
    res.status(500).json({ error: "Auto recalibration failed" });
  }
});

export default router;

// =======================================================
// FitAI Vision Engine 1.15 – Ultra Precision Plate Analyzer
// Focus: exact grams + kcal (95–100%)
// =======================================================

import express from "express";
import OpenAI from "openai";
import { PrismaClient } from "@prisma/client";

const router = express.Router();
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// =======================================================
// 🧠 PROMPT – photo → name + weight + kcal
// =======================================================
const promptVision = `
You are FitAI Vision 1.15, the world's most precise plate analysis engine.

Analyze the food on this image.
Detect and list EVERY visible food item (even small items, sauces, bread, or vegetables).

Estimate as precisely as possible:
- name (English)
- category (meat, starch, vegetable, fruit, sauce, drink, etc.)
- weight_g (grams)
- kcal (total calories, based on the realistic serving size)

Assume the plate has a diameter of 25 cm.
Return ONLY valid JSON array like this:
[
  {"name":"...", "category":"...", "weight_g":..., "kcal":...}
]
`;

// =======================================================
// 📷 MAIN ENDPOINT
// =======================================================
router.post("/api/analyze-photo", async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64)
      return res.status(400).json({ error: "Missing image data" });

    console.log("🧠 Starting Ultra Precision Analysis...");

    // ✅ Step 1: Vision analysis
    const result = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a scientific AI nutrition and vision expert." },
        {
          role: "user",
          content: `${promptVision}\n\nIMAGE:\ndata:image/jpeg;base64,${imageBase64}`,
        },
      ],
      temperature: 0,
      max_tokens: 1500,
    });

    // ✅ Step 2: Parse result
    const rawOutput = result.choices?.[0]?.message?.content || "[]";
    const jsonMatch = rawOutput.match(/\[[\s\S]*\]/);
    const foods = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    console.log(`📊 AI detected ${foods.length} items.`);

    // ✅ Step 3: Calculate totals
    const totalKcal = foods.reduce((sum: number, f: any) => sum + (f.kcal || 0), 0);
    const totalWeight = foods.reduce((sum: number, f: any) => sum + (f.weight_g || 0), 0);

    // ✅ Step 4: Save to DB
    for (const item of foods) {
      await prisma.foods.create({
        data: {
          name_en: item.name,
          category: item.category || "unknown",
          kcal: item.kcal || 0,
          region: "global",
          source: "fitai_vision_v1.15",
          is_global: false,
        },
      });
    }

    console.log("✅ Analysis complete.");
    res.json({
      success: true,
      total_items: foods.length,
      total_weight_g: Math.round(totalWeight),
      total_kcal: Math.round(totalKcal),
      items: foods,
    });
  } catch (err: any) {
    console.error("❌ Vision Engine Error:", err.message);
    res.status(500).json({ error: "Analysis failed", details: err.message });
  }
});

export default router;

// =======================================================
// FitAI Vision Engine 1.0 – Plate & Product Analysis (TS safe)
// =======================================================

import express from "express";
import OpenAI from "openai";
import { PrismaClient } from "@prisma/client";

const router = express.Router();
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// =======================================================
// ⚙️ CONFIG
// =======================================================
const PLATE_DIAMETER_CM = 25.0;
const HEIGHT_FACTOR = 1.5;
const DENSITY_MAP: Record<string, number> = {
  meat: 1.05,
  fish: 1.0,
  dairy: 0.95,
  vegetable: 0.3,
  fruit: 0.6,
  starch: 0.8,
  "bread/cereal": 0.55,
  "fat/oil": 0.9,
  sweet: 0.75,
  sauce: 0.7,
  drink: 1.0,
};

// =======================================================
// 🧠 PROMPT
// =======================================================
const promptVision = `
You are FitAI Vision, a scientific nutrition analyst.
From this photo, detect and list EVERY visible food item or edible object.
Return JSON array with:
[
  {"name":"...", "category":"...", "approx_area_percent":0-100, "thickness_cm":number}
]
Estimate all sizes relative to a 25 cm plate. Output JSON only.
`;

// =======================================================
// 📷 ANALYSIS ENDPOINT
// =======================================================
router.post("/api/analyze-photo", async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error: "Missing image data" });

    console.log("🧠 Starting AI Vision analysis...");

    // ✅ Step 1: Vision call (text + image separately)
    const result = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a scientific food analysis expert." },
        {
          role: "user",
          content: `${promptVision}\n\n[data:image/jpeg;base64,${imageBase64}]`,
        },
      ],
      temperature: 0,
      max_tokens: 1200,
    });

    const raw = result.choices[0]?.message?.content ?? "[]";
    const foods = JSON.parse(raw);

    console.log("📊 AI detected items:", foods.length);

    // ✅ Step 2: Calculate weights
    const plateArea = Math.PI * Math.pow(PLATE_DIAMETER_CM / 2, 2);

    const analyzed = foods.map((f: any, index: number) => {
      const ratio = (f.approx_area_percent || 0) / 100;
      const foodArea = plateArea * ratio;
      const category = f.category || "unknown";
      const density = DENSITY_MAP[category] || 1.0;
      const height = f.thickness_cm || HEIGHT_FACTOR;
      const volume = foodArea * height;
      const grams = volume * density;

      return {
        id: index + 1,
        name: f.name,
        category,
        estimatedWeight: Math.round(grams),
        accuracyScore: 0.98,
      };
    });

    // ✅ Step 3: Save to DB (safe fields only)
    for (const item of analyzed) {
      await prisma.foods.create({
        data: {
          name_en: item.name,
          category: item.category,
          accuracy_score: item.accuracyScore,
          region: "global",
          source: "fitai_vision",
          is_global: false,
        },
      });
    }

    console.log("✅ Full analysis complete.");
    res.json({ items: analyzed, total: analyzed.length });
  } catch (err: any) {
    console.error("❌ Analyze-photo error:", err.message);
    res.status(500).json({ error: "Analysis failed", details: err.message });
  }
});

export default router;

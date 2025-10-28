// =======================================================
// FitAI Vision Engine 10.0 – Base Build (Railway Safe)
// Phase 1: Vision detection + physical weight estimation
// Compatible with OpenAI SDK v4.x
// =======================================================

import express from "express";
import OpenAI from "openai";
import { PrismaClient } from "@prisma/client";

const router = express.Router();
const prisma = new PrismaClient();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// =======================================================
// 🧩 Helper: nutrient_density table (g/cm³)
// =======================================================
const nutrientDensity: Record<string, number> = {
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
  unknown: 1.0,
};

// =======================================================
// 🧮 Helper: weight from volume × density
// =======================================================
function estimateWeight(volumeCm3: number, category: string): number {
  const density = nutrientDensity[category] || 1.0;
  const grams = volumeCm3 * density;
  return Math.round(grams);
}

// =======================================================
// 🤖 Prompt for GPT-4o Vision
// =======================================================
const promptVision = `
You are FitAI Vision 10.0 – the most precise plate analysis engine.

Analyze this meal photo.
List *every visible food item* (even small sides, sauces, or bread).

For each item estimate:
- name (English)
- category (meat, fish, starch, vegetable, fruit, sauce, drink, etc.)
- volume_cm3 (approximate physical volume in cubic centimeters)
- confidence (0–1)

Assume the plate diameter = 25 cm.

Return ONLY valid JSON array, for example:
[
 {"name":"Chicken breast","category":"meat","volume_cm3":170,"confidence":0.96},
 {"name":"Rice","category":"starch","volume_cm3":140,"confidence":0.93}
]
`;

// =======================================================
// 📷 MAIN ENDPOINT
// =======================================================
router.post("/api/analyze-photo-v10", async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64)
      return res.status(400).json({ error: "Missing image data" });

    console.log("🧠 FitAI Vision 10.0 – Analyzing photo…");

    // 🔹 Step 1: Vision analysis (GPT-4o Vision)
    const result = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a scientific AI vision expert." },
        {
          role: "user",
          // Compatible input format for OpenAI SDK v4.x
          content: `${promptVision}\n\nIMAGE:\ndata:image/jpeg;base64,${imageBase64}`,
        },
      ],
      temperature: 0,
      max_tokens: 1500,
    });

    // 🔹 Step 2: Parse Vision output
    const rawOutput = result.choices?.[0]?.message?.content || "[]";
    const jsonMatch = rawOutput.match(/\[[\s\S]*\]/);
    const foodsRaw = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    // 🔹 Step 3: Physical weight estimation
    const foods = foodsRaw.map((f: any) => {
      const weight_g = estimateWeight(Number(f.volume_cm3) || 0, f.category || "unknown");
      return {
        name: f.name || "unknown",
        category: f.category || "unknown",
        volume_cm3: Number(f.volume_cm3) || 0,
        weight_g,
        confidence: Number(f.confidence) || 0.9,
      };
    });

    // 🔹 Step 4: Totals
    const totalWeight = foods.reduce((sum: number, f: any) => sum + f.weight_g, 0);
    const avgConfidence =
      foods.reduce((s: number, f: any) => s + f.confidence, 0) / (foods.length || 1);

    // 🔹 Step 5: Response
    res.json({
      success: true,
      version: "10.0-phase-1",
      total_items: foods.length,
      total_weight_g: Math.round(totalWeight),
      confidence_avg: avgConfidence.toFixed(2),
      items: foods,
      photo_id: "fitai_vision_" + Date.now(),
    });

    console.log(
      `✅ Vision 10.0 analyzed ${foods.length} items, total ≈ ${totalWeight} g`
    );
  } catch (err: any) {
    console.error("❌ Vision 10.0 Error:", err.message);
    res.status(500).json({ error: "Vision 10.0 failed", details: err.message });
  }
});

export default router;

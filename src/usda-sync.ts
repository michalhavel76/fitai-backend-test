import express from "express";
import fetch from "node-fetch";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = express.Router();

const USDA_API_KEY = process.env.USDA_API_KEY || "YOUR_USDA_KEY";
const USDA_SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search?api_key=" + USDA_API_KEY;

router.post("/usda-sync", async (req, res) => {
  try {
    const { food } = req.body;
    if (!food) return res.status(400).json({ error: "Missing food name" });

    console.log("🔎 Searching USDA for:", food);
    const searchRes = await fetch(`${USDA_SEARCH_URL}&query=${encodeURIComponent(food)}&pageSize=1`);
    const searchData = await searchRes.json();

    if (!searchData.foods?.length) {
      return res.status(404).json({ error: "No match found in USDA." });
    }

    const fdcId = searchData.foods[0].fdcId;
    console.log("📦 USDA match found, FDC ID:", fdcId);

    const foodRes = await fetch(`https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${USDA_API_KEY}`);
    const foodData = await foodRes.json();

    const nutrients: Record<string, number> = {};
    foodData.foodNutrients?.forEach((n: any) => {
      const name = n.nutrient?.name?.toLowerCase() || "";
      const val = n.amount || 0;

      if (name.includes("vitamin a")) nutrients.vitamin_a = val;
      if (name.includes("vitamin c")) nutrients.vitamin_c = val;
      if (name.includes("vitamin d")) nutrients.vitamin_d = val;
      if (name.includes("vitamin e")) nutrients.vitamin_e = val;
      if (name.includes("vitamin k")) nutrients.vitamin_k = val;
      if (name.includes("calcium")) nutrients.calcium = val;
      if (name.includes("iron")) nutrients.iron = val;
      if (name.includes("zinc")) nutrients.zinc = val;
      if (name.includes("magnesium")) nutrients.magnesium = val;
      if (name.includes("phosphorus")) nutrients.phosphorus = val;
      if (name.includes("potassium")) nutrients.potassium = val;
      if (name.includes("copper")) nutrients.copper = val;
      if (name.includes("manganese")) nutrients.manganese = val;
      if (name.includes("selenium")) nutrients.selenium = val;
      if (name.includes("sodium")) nutrients.sodium = val;
      if (name.includes("cholesterol")) nutrients.cholesterol = val;
      if (name.includes("fatty acids, total monounsaturated")) nutrients.monounsaturated_fat = val;
      if (name.includes("fatty acids, total polyunsaturated")) nutrients.polyunsaturated_fat = val;
      if (name.includes("fatty acids, total trans")) nutrients.trans_fat = val;
      if (name.includes("water")) nutrients.water = val;
    });

    // 🧩 TypeScript fix – ignore Prisma auto-id warning
    // @ts-ignore
    const updated = await prisma.foods.upsert({
      where: { name_en: food.toLowerCase() },
      update: nutrients,
      create: {
        name_en: food.toLowerCase(),
        ...nutrients,
        source: "USDA",
        region: "global",
        is_global: true,
        accuracy_score: 1.0,
      },
    });

    console.log("✅ USDA Sync complete:", updated.name_en);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    console.error("❌ USDA Sync Error:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;

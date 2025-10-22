// =======================================================
// FitAI Backend 4.9 – Scientific Calibration System
// Global Food Normalization & Accuracy Framework
// Full Safe Build – 2025-10-19
// =======================================================

import express from "express";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import OpenAI from "openai";
import axios from "axios";
import { Pool } from "pg";

// 🌍 Routes
import usdaSyncRoute from "./usda-sync";
import nutrientFill from "./nutrient-fill";
import datahubEngineRoute from "./datahub-engine";
import neverZeroRouter from "./neverzero-engine";
import searchFoodRoute from "./search-food";
import verifySourceRoute from "./verify-source";
import normalizeRoute from "./normalize-engine";
import normalizeSmart from "./normalize-engine";
import verifyAccuracy from "./verify-accuracy";

// @ts-ignore – JS module (no declaration)
import scientificCorrection from "./scientific-correction";
// @ts-ignore – JS module (no declaration)
import { scientificCalibrate } from "./scientific-calibration";
import manualFill42 from "./manual-fill-42";
import scientificFill42 from "./scientific-fill-42";

// =======================================================
// 🌍 INIT SERVER + CONFIG
// =======================================================
dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ limit: "20mb", extended: true }));
app.use(express.static("public"));

// =======================================================
// 🧠 DATABASE CONNECTION (Railway PostgreSQL)
// =======================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool
  .connect()
  .then(() => console.log("🟢 Connected to PostgreSQL"))
  .catch((err) => console.error("🔴 DB error:", err.message));

// =======================================================
// ⚙️ BASE CONFIGS
// =======================================================
const upload = multer({ dest: "uploads/" });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const NUTRITIONIX_APP_ID = process.env.NUTRITIONIX_APP_ID;
const NUTRITIONIX_API_KEY = process.env.NUTRITIONIX_API_KEY;

// =======================================================
// 🧩 PING (Server health check)
// =======================================================
app.get("/ping", (_, res) => res.send("pong"));

// =======================================================
// 🍽️ ANALYZE PLATE (AI + Nutritionix + AutoFill vitamins)
// =======================================================
app.post("/analyze-plate", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image" });
    const b64 = fs.readFileSync(req.file.path, { encoding: "base64" });

    const visionResp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a nutrition expert. Return JSON with an 'ingredients' array of foods visible on the plate.",
        },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
          ],
        },
      ],
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(visionResp.choices[0].message.content || "{}");
    const ingredients: string[] = parsed.ingredients || [];
    const items: any[] = [];

    for (const ing of ingredients) {
      const local = await pool.query(
        "SELECT * FROM foods WHERE LOWER(name_en) LIKE LOWER($1) OR LOWER(name_cz) LIKE LOWER($1) LIMIT 1",
        [`%${ing}%`]
      );

      if (local.rows.length > 0) {
        items.push(local.rows[0]);
        continue;
      }

      try {
        const nutriResp = await axios.post(
          "https://trackapi.nutritionix.com/v2/natural/nutrients",
          { query: ing },
          {
            headers: {
              "x-app-id": NUTRITIONIX_APP_ID!,
              "x-app-key": NUTRITIONIX_API_KEY!,
              "Content-Type": "application/json",
            },
          }
        );

        const f = nutriResp.data.foods[0];
        const newFood = {
          name_en: f.food_name,
          name_cz: f.food_name,
          kcal: Number(f.nf_calories),
          protein: Number(f.nf_protein),
          carbs: Number(f.nf_total_carbohydrate),
          fat: Number(f.nf_total_fat),
          image_url: f.photo?.thumb || null,
          source: "nutritionix",
        };

        await pool.query(
          `INSERT INTO foods (name_en, name_cz, kcal, protein, carbs, fat, image_url, source, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
          [
            newFood.name_en,
            newFood.name_cz,
            newFood.kcal,
            newFood.protein,
            newFood.carbs,
            newFood.fat,
            newFood.image_url,
            newFood.source,
          ]
        );

        await axios.post("http://localhost:4000/api/nutrient-fill", {
          food: newFood.name_en,
        });

        items.push(newFood);
      } catch (err: any) {
        console.error("Nutritionix error:", err.message);
      }
    }

    const totals = items.reduce(
      (acc, i) => {
        acc.kcal += Number(i.kcal) || 0;
        acc.protein += Number(i.protein) || 0;
        acc.carbs += Number(i.carbs) || 0;
        acc.fat += Number(i.fat) || 0;
        return acc;
      },
      { kcal: 0, protein: 0, carbs: 0, fat: 0 }
    );

    res.json({
      items,
      totals: {
        calories: Math.round(totals.kcal),
        protein: Math.round(totals.protein),
        carbs: Math.round(totals.carbs),
        fat: Math.round(totals.fat),
      },
    });
  } catch (err: any) {
    console.error("Analyze error:", err.message);
    res.status(500).json({ error: "Analyze error" });
  }
});

// =======================================================
// 🧬 USDA SYNC (Enhanced Search + 10 results fallback)
// =======================================================
app.post("/usda-sync", async (req, res) => {
  try {
    const { food } = req.body;
    if (!food) return res.status(400).json({ error: "Missing food name" });

    const USDA_API_KEY = "CoapVie1RnpUCrfGNfbeoDyG0Ut3DNktWOyLnUC0";
    const USDA_SEARCH_URL = `https://api.nal.usda.gov/fdc/v1/foods/search`;

    console.log("🔎 Searching USDA for:", food);

    const searchRes = await axios.get(USDA_SEARCH_URL, {
      params: { api_key: USDA_API_KEY, query: food, pageSize: 10 },
    });

    const results = searchRes.data.foods || [];
    if (results.length === 0)
      return res.status(404).json({ error: `No match found in USDA for "${food}"` });

    const fdcId = results[0].fdcId;
    console.log("✅ Found USDA entry:", results[0].description);

    const foodRes = await axios.get(
      `https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${USDA_API_KEY}`
    );

    const foodData = foodRes.data;
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
      if (name.includes("monounsaturated")) nutrients.monounsaturated_fat = val;
      if (name.includes("polyunsaturated")) nutrients.polyunsaturated_fat = val;
      if (name.includes("trans")) nutrients.trans_fat = val;
      if (name.includes("water")) nutrients.water = val;
    });

    await pool.query(
      `INSERT INTO foods (name_en, name_cz, region, source, is_global, accuracy_score, created_at)
       VALUES ($1,$1,'global','USDA',true,1.0,NOW())
       ON CONFLICT (name_en) DO UPDATE SET region='global', source='USDA', updated_at=NOW()`,
      [food.toLowerCase()]
    );

    res.json({ success: true, nutrients });
  } catch (err: any) {
    console.error("❌ USDA Sync Error:", err.message);
    res.status(500).json({ error: "USDA sync failed" });
  }
});

// =======================================================
// 🧬 SCIENTIFIC CALIBRATION (NEW IN 4.8)
// =======================================================
app.post("/api/scientific-calibrate", scientificCalibrate);

// =======================================================
// 🔍 ROUTES
// =======================================================
app.use("/", usdaSyncRoute);
app.use("/", datahubEngineRoute);
app.use("/api", nutrientFill);
app.use("/", neverZeroRouter);
app.use("/", searchFoodRoute);
app.use("/", verifySourceRoute);
app.use("/", normalizeRoute);
app.use("/", normalizeSmart);
app.use("/", verifyAccuracy);

// 🔧 Moved up before correction
app.post("/api/scientific-fill-42", scientificFill42);

app.use("/", scientificCorrection);
app.use(manualFill42);

// =======================================================
// 🚀 SERVER START
// =======================================================
app.listen(port, () => {
  console.log(`✅ FitAI Backend 4.9 running on port ${port}`);
});

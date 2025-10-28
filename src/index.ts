// =======================================================
// FitAI Backend 4.9 – Scientific Calibration System
// Global Food Normalization & Accuracy Framework
// Full Safe Build – 2025-10-28 (no scientific-correction)
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
import analyzePhotoV10Route from "./api/analyze-photo.v10";

// @ts-ignore – JS module (no declaration)
import { scientificCalibrate } from "./scientific-calibration";

// =======================================================
// 🌍 INIT SERVER + CONFIG
// =======================================================
dotenv.config();

const app = express();
const port = process.env.PORT || 8800;

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
          content: `${"data:image/jpeg;base64,"}${b64}`,
        },
      ],
      temperature: 0,
      max_tokens: 800,
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
app.use(analyzePhotoV10Route);

// =======================================================
// 🚀 SERVER START
// =======================================================
app.listen(port, () => {
  console.log(`✅ FitAI Backend 4.9 running on port ${port}`);
});

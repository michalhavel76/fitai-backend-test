import express from "express";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import OpenAI from "openai";
import axios from "axios";
import { Pool } from "pg";

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ limit: "20mb", extended: true }));
app.use(express.static("public"));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const upload = multer({ dest: "uploads/" });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const NUTRITIONIX_APP_ID = process.env.NUTRITIONIX_APP_ID;
const NUTRITIONIX_API_KEY = process.env.NUTRITIONIX_API_KEY;

pool
  .connect()
  .then(() => console.log("🟢 Connected to PostgreSQL"))
  .catch((err) => console.error("🔴 DB error:", err.message));

app.get("/ping", (_, res) => res.send("pong"));

/* =======================================================
   🍽️ ANALYZE PLATE
======================================================= */
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
        "SELECT * FROM foods WHERE LOWER(name_cz) LIKE LOWER($1) OR LOWER(name_en) LIKE LOWER($1) LIMIT 1",
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
          category: f.tags?.item || null,
          origin: f.brand_name || null,
          kcal: Number(f.nf_calories) || 0,
          protein: Number(f.nf_protein) || 0,
          carbs: Number(f.nf_total_carbohydrate) || 0,
          fat: Number(f.nf_total_fat) || 0,
          fiber: Number(f.full_nutrients?.find((n: any) => n.attr_id === 291)?.value || 0),
          sugar: Number(f.full_nutrients?.find((n: any) => n.attr_id === 269)?.value || 0),
          sodium: Number(f.full_nutrients?.find((n: any) => n.attr_id === 307)?.value || 0),
          vitamin_a: Number(f.full_nutrients?.find((n: any) => n.attr_id === 320)?.value || 0),
          vitamin_c: Number(f.full_nutrients?.find((n: any) => n.attr_id === 401)?.value || 0),
          calcium: Number(f.full_nutrients?.find((n: any) => n.attr_id === 301)?.value || 0),
          iron: Number(f.full_nutrients?.find((n: any) => n.attr_id === 303)?.value || 0),
          source: "nutritionix",
          image_url: f.photo?.thumb || null,
          lang: { detected: "en" },
        };

        await pool.query(
          `INSERT INTO foods (
            name_en, name_cz, category, origin, kcal, protein, carbs, fat,
            fiber, sugar, sodium, vitamin_a, vitamin_c, calcium, iron,
            source, image_url, lang, created_at
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW()
          )`,
          [
            newFood.name_en,
            newFood.name_cz,
            newFood.category,
            newFood.origin,
            newFood.kcal,
            newFood.protein,
            newFood.carbs,
            newFood.fat,
            newFood.fiber,
            newFood.sugar,
            newFood.sodium,
            newFood.vitamin_a,
            newFood.vitamin_c,
            newFood.calcium,
            newFood.iron,
            newFood.source,
            newFood.image_url,
            JSON.stringify(newFood.lang),
          ]
        );

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

/* =======================================================
   🔍 SUGGEST (DB → Nutritionix fallback)
======================================================= */
const suggestCache = new Map<string, { data: any[]; time: number }>();
const CACHE_TTL = 3000;

app.get("/suggest", async (req, res) => {
  try {
    const { query } = req.query;
    if (!query || typeof query !== "string") return res.json([]);

    const lowerQ = query.toLowerCase();
    const cached = suggestCache.get(lowerQ);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      return res.json(cached.data);
    }

    // 1️⃣ Lokální DB
    const local = await pool.query(
      `SELECT * FROM foods 
       WHERE LOWER(name_cz) LIKE LOWER($1) OR LOWER(name_en) LIKE LOWER($1)
       ORDER BY name_cz ASC LIMIT 10`,
      [`%${lowerQ}%`]
    );

    if (local.rows.length > 0) {
      suggestCache.set(lowerQ, { data: local.rows, time: Date.now() });
      return res.json(local.rows);
    }

    // 2️⃣ Nutritionix fallback
    const nutriResp = await axios.post(
      "https://trackapi.nutritionix.com/v2/natural/nutrients",
      { query },
      {
        headers: {
          "x-app-id": NUTRITIONIX_APP_ID!,
          "x-app-key": NUTRITIONIX_API_KEY!,
          "Content-Type": "application/json",
        },
      }
    );

    if (!nutriResp.data.foods || nutriResp.data.foods.length === 0) {
      return res.json([]);
    }

    const f = nutriResp.data.foods[0];
    const newFood = {
      name_en: f.food_name,
      name_cz: f.food_name,
      category: f.tags?.item || null,
      origin: f.brand_name || null,
      kcal: Number(f.nf_calories) || 0,
      protein: Number(f.nf_protein) || 0,
      carbs: Number(f.nf_total_carbohydrate) || 0,
      fat: Number(f.nf_total_fat) || 0,
      fiber: Number(f.full_nutrients?.find((n: any) => n.attr_id === 291)?.value || 0),
      sugar: Number(f.full_nutrients?.find((n: any) => n.attr_id === 269)?.value || 0),
      sodium: Number(f.full_nutrients?.find((n: any) => n.attr_id === 307)?.value || 0),
      vitamin_a: Number(f.full_nutrients?.find((n: any) => n.attr_id === 320)?.value || 0),
      vitamin_c: Number(f.full_nutrients?.find((n: any) => n.attr_id === 401)?.value || 0),
      calcium: Number(f.full_nutrients?.find((n: any) => n.attr_id === 301)?.value || 0),
      iron: Number(f.full_nutrients?.find((n: any) => n.attr_id === 303)?.value || 0),
      source: "nutritionix",
      image_url: f.photo?.thumb || null,
      lang: { detected: "en" },
    };

    await pool.query(
      `INSERT INTO foods (
        name_en, name_cz, category, origin, kcal, protein, carbs, fat,
        fiber, sugar, sodium, vitamin_a, vitamin_c, calcium, iron,
        source, image_url, lang, created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW()
      )`,
      [
        newFood.name_en,
        newFood.name_cz,
        newFood.category,
        newFood.origin,
        newFood.kcal,
        newFood.protein,
        newFood.carbs,
        newFood.fat,
        newFood.fiber,
        newFood.sugar,
        newFood.sodium,
        newFood.vitamin_a,
        newFood.vitamin_c,
        newFood.calcium,
        newFood.iron,
        newFood.source,
        newFood.image_url,
        JSON.stringify(newFood.lang),
      ]
    );

    suggestCache.set(lowerQ, { data: [newFood], time: Date.now() });
    return res.json([newFood]);
  } catch (err: any) {
    console.error("❌ Suggest error:", err.message);
    res.json([]);
  }
});

app.listen(port, () => {
  console.log(`✅ FitAI Backend 3.0 running on port ${port}`);
});

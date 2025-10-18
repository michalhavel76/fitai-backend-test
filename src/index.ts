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
          kcal: Number(f.nf_calories) || 0,
          protein: Number(f.nf_protein) || 0,
          carbs: Number(f.nf_total_carbohydrate) || 0,
          fat: Number(f.nf_total_fat) || 0,
          image_url: f.photo?.thumb || "https://cdn-icons-png.flaticon.com/512/857/857681.png",
          source: "nutritionix",
        };

        await pool.query(
          "INSERT INTO foods (name_en, name_cz, kcal, protein, carbs, fat, image_url, source, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())",
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
   🔍 SMART DUAL SUGGEST (DB + Nutritionix + image_url)
======================================================= */
const suggestCache = new Map<string, { data: any[]; time: number }>();
const CACHE_TTL = 3000;

app.get("/suggest", async (req, res) => {
  try {
    const { query } = req.query;
    if (!query || typeof query !== "string") return res.json([]);
    const lowerQ = query.toLowerCase().trim();
    if (lowerQ.length < 3) return res.json([]);

    const cached = suggestCache.get(lowerQ);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      return res.json(cached.data);
    }

    // Lokální DB
    const local = await pool.query(
      `SELECT id, name_cz, name_en, kcal, protein, carbs, fat, image_url 
       FROM foods 
       WHERE LOWER(name_cz) LIKE LOWER($1) OR LOWER(name_en) LIKE LOWER($1)
       ORDER BY name_cz ASC 
       LIMIT 10`,
      [`%${lowerQ}%`]
    );

    const localResults = local.rows.map((f: any) => ({
      id: f.id,
      name_en: f.name_en,
      name_cz: f.name_cz,
      kcal: f.kcal,
      protein: f.protein,
      carbs: f.carbs,
      fat: f.fat,
      source: "local",
      image_url: f.image_url || "https://cdn-icons-png.flaticon.com/512/857/857681.png",
    }));

    // Nutritionix fallback
    const nutriResp = await axios.post(
      "https://trackapi.nutritionix.com/v2/search/instant",
      { query },
      {
        headers: {
          "x-app-id": NUTRITIONIX_APP_ID!,
          "x-app-key": NUTRITIONIX_API_KEY!,
          "Content-Type": "application/json",
        },
      }
    );

    const foods = [
      ...(nutriResp.data.common || []),
      ...(nutriResp.data.branded || []),
    ].slice(0, 10);

    const onlineResults = foods.map((f: any) => ({
      id: null,
      name_en: f.food_name,
      name_cz: f.food_name,
      kcal: f.nf_calories ? Number(f.nf_calories) : null,
      protein: f.nf_protein ? Number(f.nf_protein) : null,
      carbs: f.nf_total_carbohydrate ? Number(f.nf_total_carbohydrate) : null,
      fat: f.nf_total_fat ? Number(f.nf_total_fat) : null,
      source: "nutritionix",
      image_url: f.photo?.thumb || "https://cdn-icons-png.flaticon.com/512/857/857681.png",
    }));

    // Uložení nových položek
    for (const food of onlineResults) {
      const exists = await pool.query(
        `SELECT 1 FROM foods WHERE LOWER(name_en) = LOWER($1) LIMIT 1`,
        [food.name_en]
      );
      if (exists.rows.length === 0) {
        await pool.query(
          `INSERT INTO foods (name_en, name_cz, kcal, protein, carbs, fat, image_url, source, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
          [
            food.name_en,
            food.name_cz,
            food.kcal,
            food.protein,
            food.carbs,
            food.fat,
            food.image_url,
            food.source,
          ]
        );
      }
    }

    const combined = [
      ...localResults,
      ...onlineResults.filter(
        (n: any) =>
          !localResults.some(
            (l: any) => l.name_en.toLowerCase() === n.name_en.toLowerCase()
          )
      ),
    ];

    suggestCache.set(lowerQ, { data: combined, time: Date.now() });
    return res.json(combined);
  } catch (err: any) {
    console.error("❌ Suggest error:", err.message);
    res.json([]);
  }
});

/* =======================================================
   ⚖️ CALCULATE SINGLE FOOD (používá se při editaci)
======================================================= */
app.post("/calculate-food", async (req, res) => {
  try {
    const { food, grams } = req.body;
    if (!food) return res.json({ success: false, error: "Missing food name" });
    const g = Number(grams) || 100;

    // 1️⃣ zkusíme DB
    const local = await pool.query(
      `SELECT * FROM foods WHERE LOWER(name_en) = LOWER($1) OR LOWER(name_cz) = LOWER($1) LIMIT 1`,
      [food.toLowerCase()]
    );

    if (local.rows.length > 0) {
      const f = local.rows[0];
      const result = {
        calories: (f.kcal / 100) * g,
        protein: (f.protein / 100) * g,
        carbs: (f.carbs / 100) * g,
        fat: (f.fat / 100) * g,
      };
      return res.json({ success: true, name: f.name_en, result });
    }

    // 2️⃣ fallback Nutritionix
    const nutriResp = await axios.post(
      "https://trackapi.nutritionix.com/v2/natural/nutrients",
      { query: food },
      {
        headers: {
          "x-app-id": NUTRITIONIX_APP_ID!,
          "x-app-key": NUTRITIONIX_API_KEY!,
          "Content-Type": "application/json",
        },
      }
    );

    const f = nutriResp.data.foods[0];
    const result = {
      calories: (Number(f.nf_calories) / 100) * g,
      protein: (Number(f.nf_protein) / 100) * g,
      carbs: (Number(f.nf_total_carbohydrate) / 100) * g,
      fat: (Number(f.nf_total_fat) / 100) * g,
    };

    await pool.query(
      `INSERT INTO foods (name_en, name_cz, kcal, protein, carbs, fat, image_url, source, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT DO NOTHING`,
      [
        f.food_name,
        f.food_name,
        Number(f.nf_calories),
        Number(f.nf_protein),
        Number(f.nf_total_carbohydrate),
        Number(f.nf_total_fat),
        f.photo?.thumb || "https://cdn-icons-png.flaticon.com/512/857/857681.png",
        "nutritionix",
      ]
    );

    return res.json({ success: true, name: f.food_name, result });
  } catch (err: any) {
    console.error("❌ Calculate error:", err.message);
    res.json({ success: false, error: "Calculation failed" });
  }
});

app.listen(port, () => {
  console.log(`✅ FitAI Backend 3.1 running on port ${port}`);
});

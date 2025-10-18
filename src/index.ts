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
      `SELECT id, name_cz, name_en, kcal, protein, carbs, fat, image_url 
       FROM foods 
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

    suggestCache.set(lowerQ, { data: [newFood], time: Date.now() });
    return res.json([newFood]);
  } catch (err: any) {
    console.error("❌ Suggest error:", err.message);
    res.json([]);
  }
});

/* =======================================================
   ⚖️ CALCULATE SINGLE FOOD (přepočet při editaci)
======================================================= */
app.post("/calculate-food", async (req, res) => {
  try {
    const { food, grams } = req.body;
    if (!food) return res.json({ success: false, error: "Missing food name" });

    const lowerFood = food.toLowerCase();
    const g = Number(grams) || 100;

    // 1️⃣ Hledání v DB
    const local = await pool.query(
      `SELECT * FROM foods WHERE LOWER(name_en) = $1 OR LOWER(name_cz) = $1 LIMIT 1`,
      [lowerFood]
    );

    if (local.rows.length > 0) {
      const f = local.rows[0];
      const result = {
        calories: (Number(f.kcal) / 100) * g,
        protein: (Number(f.protein) / 100) * g,
        carbs: (Number(f.carbs) / 100) * g,
        fat: (Number(f.fat) / 100) * g,
      };
      return res.json({ success: true, name: f.name_cz || f.name_en, result });
    }

    // 2️⃣ Nutritionix fallback
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

    const result = {
      calories: (newFood.kcal / 100) * g,
      protein: (newFood.protein / 100) * g,
      carbs: (newFood.carbs / 100) * g,
      fat: (newFood.fat / 100) * g,
    };

    return res.json({ success: true, name: newFood.name_cz, result });
  } catch (err: any) {
    console.error("❌ Calculate error:", err.message);
    res.json({ success: false, error: "Calculation failed" });
  }
});

app.listen(port, () => {
  console.log(`✅ FitAI Backend 3.2 running on port ${port}`);
});

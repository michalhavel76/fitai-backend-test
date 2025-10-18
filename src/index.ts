import express from "express";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import OpenAI from "openai";
import axios from "axios";
import { Pool } from "pg";
import usdaSyncRoute from "./usda-sync";

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
   ⚖️ CALCULATE SINGLE FOOD (auto re-sync pokud chybí makra)
======================================================= */
app.post("/calculate-food", async (req, res) => {
  try {
    const { food, grams } = req.body;
    if (!food) return res.json({ success: false, error: "Missing food name" });

    const lowerFood = food.toLowerCase();
    const g = Number(grams) || 100;

    const localRes = await pool.query(
      `SELECT * FROM foods WHERE LOWER(name_en) = $1 OR LOWER(name_cz) = $1 LIMIT 1`,
      [lowerFood]
    );

    let foodData = localRes.rows[0];
    let fromNutritionix = false;

    const isIncomplete =
      !foodData ||
      Number(foodData.protein) === 0 ||
      Number(foodData.carbs) === 0 ||
      Number(foodData.fat) === 0;

    if (isIncomplete) {
      console.log("🔄 Refreshing from Nutritionix:", food);

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

      const f = nutriResp.data.foods?.[0];
      if (!f) return res.json({ success: false, error: "No food found" });

      const findNutrient = (id: number) =>
        f.full_nutrients?.find((n: any) => n.attr_id === id)?.value || 0;

      const kcal = Number(f.nf_calories) || findNutrient(208) || 0;
      const protein = Number(f.nf_protein) || findNutrient(203) || 0;
      const carbs = Number(f.nf_total_carbohydrate) || findNutrient(205) || 0;
      const fat = Number(f.nf_total_fat) || findNutrient(204) || 0;
      const image_url = f.photo?.thumb || null;

      if (foodData) {
        await pool.query(
          `UPDATE foods 
           SET kcal=$1, protein=$2, carbs=$3, fat=$4, image_url=$5, source='nutritionix', updated_at=NOW() 
           WHERE id=$6`,
          [kcal, protein, carbs, fat, image_url, foodData.id]
        );
      } else {
        const insertRes = await pool.query(
          `INSERT INTO foods (name_en, name_cz, kcal, protein, carbs, fat, image_url, source, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'nutritionix',NOW())
           RETURNING *`,
          [f.food_name, f.food_name, kcal, protein, carbs, fat, image_url]
        );
        foodData = insertRes.rows[0];
      }

      fromNutritionix = true;
      foodData = { ...foodData, kcal, protein, carbs, fat };
    }

    const result = {
      calories: (Number(foodData.kcal) / 100) * g,
      protein: (Number(foodData.protein) / 100) * g,
      carbs: (Number(foodData.carbs) / 100) * g,
      fat: (Number(foodData.fat) / 100) * g,
    };

    console.log(
      fromNutritionix ? "🌐 Re-synced from Nutritionix:" : "✅ From DB:",
      foodData.name_en,
      result
    );

    return res.json({
      success: true,
      name: foodData.name_cz || foodData.name_en,
      result,
      source: fromNutritionix ? "nutritionix" : "local",
    });
  } catch (err: any) {
    console.error("❌ Calculate error:", err.message);
    res.json({ success: false, error: "Calculation failed" });
  }
});

/* =======================================================
   🧬 USDA SYNC (FitAI 4.0)
======================================================= */
app.post("/usda-sync", async (req, res) => {
  try {
    const { food } = req.body;
    if (!food) return res.status(400).json({ error: "Missing food name" });

    const USDA_API_KEY = "CoapVie1RnpUCrfGNfbeoDyG0Ut3DNktWOyLnUC0";
    const USDA_SEARCH_URL = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${USDA_API_KEY}`;

    console.log("🔎 Searching USDA for:", food);
    const searchRes = await axios.get(`${USDA_SEARCH_URL}&query=${encodeURIComponent(food)}&pageSize=1`);
    const searchData = searchRes.data;

    if (!searchData.foods?.length) return res.status(404).json({ error: "No match found in USDA." });

    const fdcId = searchData.foods[0].fdcId;
    const foodRes = await axios.get(`https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${USDA_API_KEY}`);
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
    res.status(500).json({ error: "Internal Server Error" });
  }
});
app.use("/", usdaSyncRoute);
app.listen(port, () => {
  console.log(`✅ FitAI Backend 4.0 Hybrid running on port ${port}`);
});

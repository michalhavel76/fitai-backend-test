import express from "express";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import OpenAI from "openai";
import axios from "axios";
import path from "path";
import { Pool } from "pg";

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

// ✅ Zvýšený limit pro Base64 fotky
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ limit: "25mb", extended: true }));
app.use(cors());
app.use(express.static("public"));

// 🗃️ PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// 📤 Upload
const upload = multer({ dest: "uploads/" });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 🔑 API keys
const NUTRITIONIX_APP_ID = process.env.NUTRITIONIX_APP_ID;
const NUTRITIONIX_API_KEY = process.env.NUTRITIONIX_API_KEY;

// ✅ DB připojení
pool
  .connect()
  .then(() => console.log("🟢 Connected to PostgreSQL (Railway)"))
  .catch((err) => console.error("🔴 DB connection error:", err.message));

/* ========================================================================== */
/* 🧠 0️⃣ DETEKCE SCÉNY (meal vs product) – rozšířená, stabilní verze         */
/* ========================================================================== */
app.post("/detectSceneType", async (req, res) => {
  try {
    const { image } = req.body;
    if (!image)
      return res.status(400).json({ success: false, message: "No image provided" });

    console.log("📥 Obrázek přijat z appky.");

    let type = "meal";
    let raw = "";

    const ai = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
            You are an image classifier for a nutrition app.
            Classify the image strictly as:
            "meal" – cooked or prepared food on a plate, bowl, table, etc.
            "product" – packaged food, brand label, chocolate, bottle, snack, wrapper, logo, barcode, or nutrition label.
            Respond only with one word: meal or product.
          `,
        },
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: image } }],
        },
      ],
    });

    raw = ai.choices?.[0]?.message?.content?.toLowerCase()?.trim() || "";
    console.log("🧠 RAW odpověď OpenAI:", raw);

    // 🔍 Chytřejší logika – rozpozná i věty a různé varianty
    if (
      raw.includes("product") ||
      raw.includes("pack") ||
      raw.includes("label") ||
      raw.includes("wrapper") ||
      raw.includes("package") ||
      raw.includes("bottle")
    ) {
      type = "product";
    } else if (
      raw.includes("meal") ||
      raw.includes("plate") ||
      raw.includes("food") ||
      raw.includes("dish") ||
      raw.includes("bowl") ||
      raw.includes("lunch") ||
      raw.includes("dinner")
    ) {
      type = "meal";
    }

    console.log("📤 Výsledek pro appku:", type);
    res.json({ success: true, type });
  } catch (err: any) {
    console.error("❌ detectSceneType error:", err.message);
    res.json({ success: true, type: "meal" }); // Fallback
  }
});

/* ========================================================================== */
/* 📸 1️⃣ ANALÝZA JÍDLA                                                      */
/* ========================================================================== */
app.post("/analyze-plate", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });

    const b64 = fs.readFileSync(req.file.path, { encoding: "base64" });

    const visionResp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a nutrition expert. Return JSON with an 'ingredients' array listing foods visible on the plate.",
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${b64}` },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(visionResp.choices[0].message.content || "{}");
    const ingredients: string[] = parsed.ingredients || [];

    console.log("🥗 Rozpoznané ingredience:", ingredients);

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
          kcal: f.nf_calories,
          protein: f.nf_protein,
          carbs: f.nf_total_carbohydrate,
          fat: f.nf_total_fat,
        };

        await pool.query(
          "INSERT INTO foods (name_en, name_cz, kcal, protein, carbs, fat) VALUES ($1,$2,$3,$4,$5,$6)",
          [
            newFood.name_en,
            newFood.name_cz,
            newFood.kcal,
            newFood.protein,
            newFood.carbs,
            newFood.fat,
          ]
        );

        items.push(newFood);
      } catch (err: any) {
        console.error("Nutritionix error:", err.message);
      }
    }

    const totals = items.reduce(
      (acc, i) => {
        acc.kcal += i.kcal || 0;
        acc.protein += i.protein || 0;
        acc.carbs += i.carbs || 0;
        acc.fat += i.fat || 0;
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

/* ========================================================================== */
/* 🤖 2️⃣ VTIPNÁ HLÁŠKA                                                     */
/* ========================================================================== */
app.post("/funny-message", upload.single("image"), async (req, res) => {
  try {
    const userName = req.body.userName || "kámo";
    if (!req.file) return res.json({ message: "Analyzuju tvoje jídlo... 😎" });

    const b64 = fs.readFileSync(req.file.path, { encoding: "base64" });

    const funnyResp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Jsi osobní kouč a parťák. Odpovídej česky, do 25 slov. " +
            "Buď motivační, sportovní, free-life, vtipný. Používej emoji, ale ne stále stejné.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Co říkáš na tohle jídlo, " + userName + "?" },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${b64}` },
            },
          ],
        },
      ],
      max_tokens: 60,
    });

    const msg =
      funnyResp.choices?.[0]?.message?.content?.trim() ||
      "Analyzuju tvoje jídlo... 😎";
    res.json({ message: msg });
  } catch (err: any) {
    console.error("Funny-message error:", err.message);
    res.json({ message: "Analyzuju tvoje jídlo... 😎" });
  }
});

/* ========================================================================== */
/* 🍎 3️⃣ PŘEPOČET POTRAVINY                                                */
/* ========================================================================== */
app.post("/calculate-food", async (req, res) => {
  try {
    const { food, grams } = req.body;
    if (!food || !grams)
      return res.status(400).json({ error: "Chybí název nebo množství (food, grams)" });

    const local = await pool.query(
      "SELECT * FROM foods WHERE LOWER(name_cz) LIKE LOWER($1) OR LOWER(name_en) LIKE LOWER($1) LIMIT 1",
      [`%${food}%`]
    );

    if (local.rows.length > 0) {
      const f = local.rows[0];
      const factor = grams / 100;
      const result = {
        calories: Math.round(f.kcal * factor),
        protein: Math.round(f.protein * factor),
        carbs: Math.round(f.carbs * factor),
        fat: Math.round(f.fat * factor),
      };
      return res.json({ success: true, source: "DB", name: f.name_cz, result });
    }

    const response = await axios.post(
      "https://trackapi.nutritionix.com/v2/natural/nutrients",
      { query: `${grams}g ${food}` },
      {
        headers: {
          "x-app-id": NUTRITIONIX_APP_ID!,
          "x-app-key": NUTRITIONIX_API_KEY!,
          "Content-Type": "application/json",
        },
      }
    );

    const item = response.data.foods[0];
    if (!item)
      return res.status(404).json({ error: "Potravina nebyla nalezena" });

    const newFood = {
      name_en: item.food_name,
      name_cz: item.food_name,
      kcal: item.nf_calories,
      protein: item.nf_protein,
      carbs: item.nf_total_carbohydrate,
      fat: item.nf_total_fat,
    };

    await pool.query(
      "INSERT INTO foods (name_en, name_cz, kcal, protein, carbs, fat) VALUES ($1,$2,$3,$4,$5,$6)",
      [
        newFood.name_en,
        newFood.name_cz,
        newFood.kcal,
        newFood.protein,
        newFood.carbs,
        newFood.fat,
      ]
    );

    res.json({ success: true, source: "Nutritionix", result: newFood });
  } catch (err: any) {
    console.error("calculate-food error:", err.message);
    res.status(500).json({ error: "Nepodařilo se spočítat hodnoty" });
  }
});

/* ========================================================================== */
/* 🚀 START SERVERU                                                         */
/* ========================================================================== */
app.listen(port, () => {
  console.log(`✅ FitAI PostgreSQL backend running at http://localhost:${port}`);
});

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

pool.connect()
  .then(() => console.log("🟢 Connected to PostgreSQL"))
  .catch(err => console.error("🔴 DB error:", err.message));

// --- TEST ---
app.get("/ping", (_, res) => res.send("pong"));

/* =======================================================
   ⚡ SUPER FAST DETECT (meal vs product) 
======================================================= */
app.post("/detectSceneType", async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.json({ success: false, type: "meal" });

    // Promise race – AI má max 3s
    const timeout = new Promise((resolve) =>
      setTimeout(() => resolve({ success: false, type: "meal", timeout: true }), 3000)
    );

    const aiCall = (async () => {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You classify quickly: respond ONLY JSON {type:'meal'|'product'}.",
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: image },
              },
            ],
          },
        ],
        max_tokens: 10,
        temperature: 0,
        response_format: { type: "json_object" },
      });

      const parsed = JSON.parse(response.choices[0].message.content || "{}");
      return { success: true, type: parsed.type || "meal" };
    })();

    const result = (await Promise.race([timeout, aiCall])) as any;
    console.log("🧠 DETECT result:", result);
    res.json(result);
  } catch (err: any) {
    console.error("❌ detectSceneType error:", err.message);
    res.json({ success: false, type: "meal" });
  }
});

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
          kcal: f.nf_calories,
          protein: f.nf_protein,
          carbs: f.nf_total_carbohydrate,
          fat: f.nf_total_fat,
        };
        await pool.query(
          "INSERT INTO foods (name_en, name_cz, kcal, protein, carbs, fat) VALUES ($1,$2,$3,$4,$5,$6)",
          [newFood.name_en, newFood.name_cz, newFood.kcal, newFood.protein, newFood.carbs, newFood.fat]
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

app.listen(port, () => {
  console.log(`✅ Fast FitAI backend on port ${port}`);
});

import express from "express";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import OpenAI from "openai";
import axios from "axios";

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ✅ Nutritionix API keys
const NUTRITIONIX_APP_ID = process.env.NUTRITIONIX_APP_ID;
const NUTRITIONIX_API_KEY = process.env.NUTRITIONIX_API_KEY;

// --- TEST endpointy
app.get("/ping", (_, res) => res.send("pong"));
app.get("/hello", (_, res) => res.send("Hello from FitAI backend!"));

// 📸 1️⃣ ANALÝZA JÍDLA
app.post("/analyze-plate", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });

    const b64 = fs.readFileSync(req.file.path, { encoding: "base64" });

    // 🔍 Vision – rozpoznání ingrediencí
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

    let parsed;
    try {
      parsed = JSON.parse(visionResp.choices[0].message.content || "{}");
    } catch {
      parsed = { ingredients: [] };
    }

    const ingredients: string[] = parsed.ingredients || [];
    const items: any[] = [];

    // 🥗 Nutritionix dotazy
    for (const ing of ingredients) {
      try {
        const nutriResp = await axios.post(
          "https://trackapi.nutritionix.com/v2/natural/nutrients",
          { query: ing },
          {
            headers: {
              "x-app-id": NUTRITIONIX_APP_ID,
              "x-app-key": NUTRITIONIX_API_KEY,
              "Content-Type": "application/json",
            },
          }
        );

        const f = nutriResp.data.foods[0];
        items.push({
          name: f.food_name,
          calories: f.nf_calories,
          protein: f.nf_protein,
          carbs: f.nf_total_carbohydrate,
          fat: f.nf_total_fat,
        });
      } catch (err) {
        console.error("Nutritionix error:", (err as any).message);
      }
    }

    // 📊 součet
    const totals = items.reduce(
      (acc, i) => {
        acc.calories += i.calories || 0;
        acc.protein += i.protein || 0;
        acc.carbs += i.carbs || 0;
        acc.fat += i.fat || 0;
        return acc;
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );

    res.json({ items, totals });
  } catch (err) {
    console.error("Analyze error:", (err as any).message);
    res

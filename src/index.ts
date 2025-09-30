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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ✅ Nutritionix keys z .env
const NUTRITIONIX_APP_ID = process.env.NUTRITIONIX_APP_ID;
const NUTRITIONIX_API_KEY = process.env.NUTRITIONIX_API_KEY;

app.get("/ping", (req, res) => res.send("pong"));
app.get("/hello", (req, res) => res.send("Hello from FitAI backend!"));

// 📸 hlavní endpoint
app.post("/analyze-plate", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    // 1️⃣ Vision → seznam ingrediencí
    const b64 = fs.readFileSync(req.file.path, { encoding: "base64" });
    const visionResp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a nutritionist. Return a JSON array of food ingredients seen on the plate.",
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
      return res.status(500).json({ error: "Vision parsing failed" });
    }

    const ingredients: string[] = parsed.ingredients || [];
    console.log("🍽 Ingredients:", ingredients);

    // 2️⃣ Nutritionix → makra pro každou ingredienci
    const items = [];
    for (const ing of ingredients) {
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

        const food = nutriResp.data.foods[0];
        items.push({
          name: food.food_name,
          calories: food.nf_calories,
          protein: food.nf_protein,
          carbs: food.nf_total_carbohydrate,
          fat: food.nf_total_fat,
        });
      } catch (e) {
        console.error("Nutritionix error:", e.message);
      }
    }

    // 3️⃣ Součty
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
    console.error(err);
    res.status(500).json({ error: "Failed to analyze plate" });
  }
});

app.listen(port, () => {
  console.log(`✅ FitAI backend running at http://localhost:${port}`);
});

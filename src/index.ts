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

// 📸 1️⃣ ANALÝZA JÍDLA (foto → ingredience → makra)
app.post("/analyze-plate", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });

    const b64 = fs.readFileSync(req.file.path, { encoding: "base64" });

    // 🔍 GPT-4 Vision: rozpoznání ingrediencí
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

    // 📊 Součet makroživin + zaokrouhlení
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

    const roundedTotals = {
      calories: Math.round(totals.calories),
      protein: Math.round(totals.protein),
      carbs: Math.round(totals.carbs),
      fat: Math.round(totals.fat),
    };

    res.json({ items, totals: roundedTotals });
  } catch (err) {
    console.error("Analyze error:", (err as any).message);
    res.json({
      items: [],
      totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    });
  }
});

// 🤖 2️⃣ VTIPNÁ HLÁŠKA (foto → GPT hláška)
app.post("/funny-message", upload.single("image"), async (req, res) => {
  try {
    const userName = req.body.userName || "kámo";
    if (!req.file)
      return res.json({ message: "Analyzuju tvoje jídlo... 😎" });

    const b64 = fs.readFileSync(req.file.path, { encoding: "base64" });

    const funnyResp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
          Jsi osobní kouč a parťák.
          Odpovídej česky, do 25 slov.
          Buď motivační, sportovní, free-life, vtipný.
          Občas pochval, občas vyhecuj. Používej emoji, ale ne stále stejné.
        `,
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Co říkáš na tohle jídlo, ${userName}?` },
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
  } catch (err) {
    console.error("Funny-message error:", (err as any).message);
    res.json({ message: "Analyzuju tvoje jídlo... 😎" });
  }
});

// 🍎 3️⃣ PŘEPOČET JEDNÉ POTRAVINY (pro editaci v appce)
app.post("/calculate-food", async (req, res) => {
  try {
    const { food, grams } = req.body;

    if (!food || !grams) {
      return res.status(400).json({
        success: false,
        error: "Chybí název nebo množství (food, grams)",
      });
    }

    const response = await axios.post(
      "https://trackapi.nutritionix.com/v2/natural/nutrients",
      { query: `${grams}g ${food}` },
      {
        headers: {
          "x-app-id": NUTRITIONIX_APP_ID,
          "x-app-key": NUTRITIONIX_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const item = response.data.foods[0];

    if (!item) {
      return res.status(404).json({
        success: false,
        error: "Potravina nebyla nalezena",
      });
    }

    const result = {
      calories: Math.round(item.nf_calories || 0),
      protein: Math.round(item.nf_protein || 0),
      carbs: Math.round(item.nf_total_carbohydrate || 0),
      fat: Math.round(item.nf_total_fat || 0),
    };

    res.json({
      success: true,
      result,
      name: item.food_name,
      serving_qty: item.serving_qty,
      serving_unit: item.serving_unit,
      photo: item.photo?.thumb || null,
    });
  } catch (err) {
    console.error("❌ Chyba /calculate-food:", (err as any).message);
    res.status(500).json({
      success: false,
      error: "Nepodařilo se spočítat hodnoty pro danou potravinu",
    });
  }
});

// 🚀 Start serveru
app.listen(port, () => {
  console.log(`✅ FitAI backend running at http://localhost:${port}`);
});

export default app;

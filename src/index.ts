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

const NUTRITIONIX_APP_ID = process.env.NUTRITIONIX_APP_ID;
const NUTRITIONIX_API_KEY = process.env.NUTRITIONIX_API_KEY;

// Helper – Nutritionix request
async function getNutritionixData(query: string) {
  try {
    const response = await axios.post(
      "https://trackapi.nutritionix.com/v2/natural/nutrients",
      { query },
      {
        headers: {
          "x-app-id": NUTRITIONIX_APP_ID,
          "x-app-key": NUTRITIONIX_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );
    return response.data.foods || [];
  } catch (err: any) {
    console.error("❌ Nutritionix error:", err.message);
    return [];
  }
}

// Helper – Czech translation of food name
async function translateToCzech(text: string) {
  try {
    const gptRes = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Přelož název jídla do přirozené češtiny pro aplikaci o výživě. Nepřekládej značky ani jednotky.",
        },
        { role: "user", content: text },
      ],
    });
    return gptRes.choices?.[0]?.message?.content?.trim() || text;
  } catch (err: any) {
    console.error("❌ Translation error:", err.message);
    return text;
  }
}

// ---------------------- /analyze-plate ----------------------
app.post("/analyze-plate", upload.single("image"), async (req, res) => {
  try {
    const imagePath = req.file?.path;
    if (!imagePath) return res.status(400).json({ error: "No image uploaded" });

    const imageBase64 = fs.readFileSync(imagePath, { encoding: "base64" });

    const gptResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a nutrition assistant. Identify visible foods in the photo and list them clearly in English, separated by commas.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Describe visible foods:" },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
          ],
        },
      ],
    });

    const text = gptResponse.choices?.[0]?.message?.content || "";
    const ingredients = text.split(/,|\n/).map((s) => s.trim()).filter(Boolean);

    let allItems: any[] = [];
    for (const item of ingredients) {
      const foods = await getNutritionixData(item);
      if (foods.length > 0) {
        const f = foods[0];
        const translated = await translateToCzech(f.food_name);
        allItems.push({
          name: translated,
          calories: Math.round(f.nf_calories || 0),
          protein: Math.round(f.nf_protein || 0),
          carbs: Math.round(f.nf_total_carbohydrate || 0),
          fat: Math.round(f.nf_total_fat || 0),
        });
      }
    }

    const totals = allItems.reduce(
      (acc, i) => {
        acc.calories += i.calories || 0;
        acc.protein += i.protein || 0;
        acc.carbs += i.carbs || 0;
        acc.fat += i.fat || 0;
        return acc;
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );

    fs.unlinkSync(imagePath);

    return res.json({ items: allItems, totals });
  } catch (err: any) {
    console.error("❌ Analyze error:", err.message);
    return res.status(500).json({ error: "Analyze failed" });
  }
});

// ---------------------- /funny-message ----------------------
app.post("/funny-message", upload.single("image"), async (req, res) => {
  try {
    const imagePath = req.file?.path;
    if (!imagePath) return res.status(400).json({ error: "No image uploaded" });

    const imageBase64 = fs.readFileSync(imagePath, { encoding: "base64" });

    const gptResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Jsi přátelský fitness coach. Napiš jednu krátkou pozitivní motivační větu o jídle na fotce, max 20 slov, max 2 emoji. Piš v češtině, v druhé osobě.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Vytvoř krátký komentář k jídlu:" },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
          ],
        },
      ],
    });

    const message = gptResponse.choices?.[0]?.message?.content || "Tohle jídlo má styl! 💪";

    fs.unlinkSync(imagePath);

    return res.json({ message });
  } catch (err: any) {
    console.error("❌ Funny message error:", err.message);
    return res.status(500).json({ message: "Dneska jíš skvěle, jen tak dál! 🍽️" });
  }
});

// ---------------------- /search-food ----------------------
app.get("/search-food", async (req, res) => {
  try {
    const query = req.query.query as string;
    if (!query) return res.status(400).json({ items: [] });

    const response = await axios.get("https://trackapi.nutritionix.com/v2/search/instant", {
      params: { query },
      headers: {
        "x-app-id": NUTRITIONIX_APP_ID,
        "x-app-key": NUTRITIONIX_API_KEY,
      },
    });

    const items = await Promise.all(
      (response.data.common || []).slice(0, 10).map(async (item: any) => {
        const cz = await translateToCzech(item.food_name);
        return { name: cz };
      })
    );

    return res.json({ items });
  } catch (err: any) {
    console.error("❌ Search error:", err.message);
    return res.json({ items: [] });
  }
});

// ---------------------- /get-food-details ----------------------
app.get("/get-food-details", async (req, res) => {
  try {
    const name = req.query.name as string;
    if (!name) return res.status(400).json({ error: "Missing name" });

    const foods = await getNutritionixData(name);
    if (!foods.length) return res.status(404).json({ error: "Not found" });

    const f = foods[0];
    const cz = await translateToCzech(f.food_name);

    return res.json({
      name: cz,
      calories: Math.round(f.nf_calories || 0),
      protein: Math.round(f.nf_protein || 0),
      carbs: Math.round(f.nf_total_carbohydrate || 0),
      fat: Math.round(f.nf_total_fat || 0),
    });
  } catch (err: any) {
    console.error("❌ Detail error:", err.message);
    return res.status(500).json({ error: "Detail fetch failed" });
  }
});

// ---------------------- /scan-barcode ----------------------
app.get("/scan-barcode", async (req, res) => {
  try {
    const code = req.query.code as string;
    if (!code) return res.status(400).json({ error: "Missing barcode" });

    const response = await axios.get(`https://world.openfoodfacts.org/api/v2/product/${code}.json`);
    const product = response.data.product;

    if (product && product.product_name) {
      const czName = await translateToCzech(product.product_name);
      const nutr = product.nutriments || {};

      return res.json({
        name: czName,
        country: product.countries_tags?.[0] || "unknown",
        calories: Math.round(nutr["energy-kcal_100g"] || 0),
        protein: Math.round(nutr["proteins_100g"] || 0),
        carbs: Math.round(nutr["carbohydrates_100g"] || 0),
        fat: Math.round(nutr["fat_100g"] || 0),
        source: "openfoodfacts",
      });
    }

    // fallback – GPT odhad
    const gptRes = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Odhadni realistické nutriční hodnoty pro 100 g daného produktu (kalorie, bílkoviny, sacharidy, tuky) a napiš výsledek jako JSON v češtině.",
        },
        { role: "user", content: `Produkt: ${code}` },
      ],
    });

    const jsonText = gptRes.choices?.[0]?.message?.content || "{}";
    let aiData;
    try {
      aiData = JSON.parse(jsonText);
    } catch {
      aiData = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    }

    return res.json({
      name: code,
      country: "unknown",
      calories: Math.round(aiData.calories || 0),
      protein: Math.round(aiData.protein || 0),
      carbs: Math.round(aiData.carbs || 0),
      fat: Math.round(aiData.fat || 0),
      source: "gpt-estimate",
    });
  } catch (err: any) {
    console.error("❌ Barcode error:", err.message);
    return res.status(500).json({ error: "Barcode scan failed" });
  }
});

// -----------------------------------------------------------
app.listen(port, () => console.log(`🚀 FitAI backend running on port ${port}`));

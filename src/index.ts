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

// --- Helper: Translate food names (only if needed) ---
async function translateName(text: string, lang: string) {
  const isBrand = /^[A-Z]/.test(text) || /[0-9]|\(|\)|®|™|-/.test(text);
  if (isBrand) return text; // don't translate brands
  try {
    const prompt = {
      cz: "Přelož do češtiny:",
      en: "Translate to English:",
      de: "Übersetze ins Deutsche:",
      es: "Traduce al español:",
      fr: "Traduire en français:",
    };
    const gptRes = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: prompt[lang as keyof typeof prompt] || prompt.en },
        { role: "user", content: text },
      ],
    });
    return gptRes.choices?.[0]?.message?.content?.trim() || text;
  } catch {
    return text;
  }
}

// --- Helper: Get Nutritionix data ---
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
  } catch {
    return [];
  }
}

// --- Helper: Get OpenFoodFacts data from multiple mirrors ---
const OFF_MIRRORS = ["world", "cz", "de", "fr", "es", "it", "pl", "us"];
async function fetchFromOpenFoodFacts(code: string) {
  for (const domain of OFF_MIRRORS) {
    try {
      const url = `https://${domain}.openfoodfacts.org/api/v2/product/${code}.json`;
      const response = await axios.get(url, { timeout: 6000 });
      if (response.data?.product && response.data.status === 1) {
        return { product: response.data.product, source: domain };
      }
    } catch {}
  }
  return null;
}

// --- Helper: Detect region fallback from language ---
function getDefaultCountry(lang: string) {
  const map: any = {
    cz: "Czech Republic",
    de: "Germany",
    es: "Spain",
    fr: "France",
    en: "United States",
  };
  return map[lang] || "World";
}

// ------------------ /scan-barcode ------------------
app.get("/scan-barcode", async (req, res) => {
  try {
    const code = req.query.code as string;
    const lang = (req.query.lang as string) || "en";
    const country = (req.query.country as string) || getDefaultCountry(lang);
    if (!code) return res.status(400).json({ error: "Missing barcode" });

    // If Czech barcode prefix → GPT fallback directly
    if (code.startsWith("859")) {
      const gptPrompt = {
        cz: `Znáš produkt s EAN ${code} z České republiky? Odhadni jeho název a nutriční hodnoty pro 100 g.`,
        en: `Guess the Czech product with EAN ${code} and estimate its nutrition for 100 g.`,
        de: `Schätze das tschechische Produkt mit EAN ${code} und seine Nährwerte pro 100 g.`,
        es: `Adivina el producto checo con EAN ${code} y estima sus valores nutricionales por 100 g.`,
        fr: `Devine le produit tchèque avec EAN ${code} et estime ses valeurs nutritionnelles pour 100 g.`,
      };
      const gptRes = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: gptPrompt[lang as keyof typeof gptPrompt] || gptPrompt.en }],
      });
      try {
        const ai = JSON.parse(gptRes.choices?.[0]?.message?.content || "{}");
        return res.json({ ...ai, source: "gpt-estimate-cz" });
      } catch {
        return res.json({ name: "Czech product", calories: 0, protein: 0, carbs: 0, fat: 0, source: "gpt-estimate-cz" });
      }
    }

    // Try OpenFoodFacts mirrors first
    const result = await fetchFromOpenFoodFacts(code);
    if (result && result.product) {
      const p = result.product;
      const name = await translateName(p.product_name || "Unknown", lang);
      const nutr = p.nutriments || {};

      if (!nutr["energy-kcal_100g"]) {
        // GPT fill missing macros
        const fillPrompt = `Estimate realistic nutrition for 100 g of ${p.product_name || "product"}. Return JSON.`;
        const gptRes = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: fillPrompt }],
        });
        try {
          const ai = JSON.parse(gptRes.choices?.[0]?.message?.content || "{}");
          return res.json({ ...ai, name, country: p.countries_tags?.[0] || result.source, source: `openfoodfacts-${result.source}` });
        } catch {}
      }

      return res.json({
        name,
        country: p.countries_tags?.[0] || result.source,
        calories: Math.round(nutr["energy-kcal_100g"] || 0),
        protein: Math.round(nutr["proteins_100g"] || 0),
        carbs: Math.round(nutr["carbohydrates_100g"] || 0),
        fat: Math.round(nutr["fat_100g"] || 0),
        source: `openfoodfacts-${result.source}`,
      });
    }

    // GPT fallback for other regions
    const prompt = `Estimate nutrition for product with EAN ${code} from ${country}. Respond in ${lang} as JSON with keys: name, calories, protein, carbs, fat.`;
    const gpt = await openai.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }] });
    try {
      const ai = JSON.parse(gpt.choices?.[0]?.message?.content || "{}");
      return res.json({ ...ai, source: `gpt-estimate-${country}` });
    } catch {
      return res.json({ name: "Unknown product", calories: 0, protein: 0, carbs: 0, fat: 0, source: `gpt-estimate-${country}` });
    }
  } catch (err: any) {
    return res.status(500).json({ error: "Barcode scan failed" });
  }
});

// ------------------ /search-food ------------------
app.get("/search-food", async (req, res) => {
  const query = req.query.query as string;
  const lang = (req.query.lang as string) || "en";
  const country = (req.query.country as string) || getDefaultCountry(lang);
  if (!query) return res.json({ items: [] });

  // Try Nutritionix first (mainly for US)
  try {
    if (country === "United States") {
      const response = await axios.get("https://trackapi.nutritionix.com/v2/search/instant", {
        params: { query },
        headers: { "x-app-id": NUTRITIONIX_APP_ID, "x-app-key": NUTRITIONIX_API_KEY },
      });
      const items = (response.data.common || []).map((f: any) => ({ name: f.food_name }));
      if (items.length > 0) return res.json({ items });
    }
  } catch {}

  // GPT fallback for European/local products
  const prompt = `List 5 likely food or product names similar to '${query}' in ${lang}. Return JSON array.`;
  const gptRes = await openai.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }] });
  try {
    const items = JSON.parse(gptRes.choices?.[0]?.message?.content || "[]").map((n: string) => ({ name: n }));
    return res.json({ items });
  } catch {
    return res.json({ items: [] });
  }
});

// -----------------------------------------------------------
app.listen(port, () => console.log(`🚀 FitAI backend v2.3 running on port ${port}`));
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

// Multer – ukládání fotek
const upload = multer({ dest: "uploads/" });

// OpenAI klient
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Nutritionix klíče
const NUTRITIONIX_APP_ID = process.env.NUTRITIONIX_APP_ID;
const NUTRITIONIX_API_KEY = process.env.NUTRITIONIX_API_KEY;

// TEST endpointy
app.get("/ping", (_, res) => res.send("pong"));
app.get("/hello", (_, res) => res.send("Hello from FitAI backend!"));

// ------------------------------------------------------------
// 📸 1) ANALÝZA JÍDLA – Vision → ingredience → makra
// ------------------------------------------------------------
app.post("/analyze-plate", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });

    const b64 = fs.readFileSync(req.file.path, { encoding: "base64" });

    // 1️⃣ Vision: extrakce ingrediencí
    const visionResp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
            You are a strict nutrition vision expert.
            ALWAYS return JSON exactly like this:
            {"ingredients":["rice","chicken","salad"]}
            Do not add anything else.
            Do not include explanations.
            Detect only foods.
          `,
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

    console.log("VISION RAW:", visionResp.choices[0].message.content);

    // 2️⃣ Parse Vision JSON
    let parsed: any = {};
    try {
      parsed = JSON.parse(visionResp.choices[0].message.content || "{}");
    } catch {
      parsed = { ingredients: [] };
    }

    let ingredients: string[] = parsed.ingredients || [];

    // 3️⃣ Pokud Vision nic nenašlo → fallback textová analýza
    if (ingredients.length === 0) {
      console.log("⚠️ Vision returned empty ingredients. Using fallback.");

      const fallback = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Extract foods from the description. Return JSON: {\"ingredients\":[...]}",
          },
          {
            role: "user",
            content: `Describe ingredients on the plate. Image (base64 omitted).`,
          },
        ],
        response_format: { type: "json_object" },
      });

      try {
        const fb = JSON.parse(fallback.choices[0].message.content || "{}");
        ingredients = fb.ingredients || [];
      } catch {
        ingredients = [];
      }
    }

    console.log("INGREDIENTS:", ingredients);

    // 4️⃣ Nutritionix dotazy
    const items: any[] = [];

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

        const f = nutriResp.data.foods[0];
        if (!f) continue;

        items.push({
          name: f.food_name,
          calories: f.nf_calories || 0,
          protein: f.nf_protein || 0,
          carbs: f.nf_total_carbohydrate || 0,
          fat: f.nf_total_fat || 0,
        });
      } catch (err) {
        console.error("Nutritionix error:", (err as any).message);
      }
    }

    // 5️⃣ Součet makroživin
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

    return res.json({ items, totals: roundedTotals });
  } catch (err) {
    console.error("Analyze error:", (err as any).message);
    return res.json({
      items: [],
      totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    });
  }
});

// ------------------------------------------------------------
// 🤖 2) VTIPNÁ HLÁŠKA – Vision → message
// ------------------------------------------------------------
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
          content: `
            Jsi motivační fit-kouč.
            Odpovídej česky, krátce, s humorem.
            Max 20 slov. Střídej emoji.
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

// ------------------------------------------------------------
// 🔢 3) Přepočet jedné potraviny
// ------------------------------------------------------------
app.post("/calculate-food", async (req, res) => {
  try {
    const { food, grams } = req.body;

    if (!food || !grams)
      return res.status(400).json({
        success: false,
        error: "Chybí název nebo množství (food, grams)",
      });

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
      return res.status(404).json({
        success: false,
        error: "Potravina nebyla nalezena",
      });

    const result = {
      calories: Math.round(item.nf_calories || 0),
      protein: Math.round(item.nf_protein || 0),
      carbs: Math.round(item.nf_total_carbohydrate || 0),
      fat: Math.round(item.nf_total_fat || 0),
    };

    return res.json({
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
      error: "Nepodařilo se spočítat hodnoty",
    });
  }
});

// ------------------------------------------------------------
// 🔎 4) Hledání potravin (autocomplete)
// ------------------------------------------------------------
app.post("/search-food", async (req, res) => {
  try {
    const { query } = req.body;

    if (!query)
      return res.status(400).json({
        success: false,
        error: "Query required",
      });

    const response = await axios.get(
      `https://trackapi.nutritionix.com/v2/search/instant?query=${query}`,
      {
        headers: {
          "x-app-id": NUTRITIONIX_APP_ID!,
          "x-app-key": NUTRITIONIX_API_KEY!,
        },
      }
    );

    const results = [
      ...response.data.common,
      ...response.data.branded,
    ]
      .slice(0, 10)
      .map((item: any) => ({
        name: item.food_name,
        brand: item.brand_name || "",
        photo: item.photo?.thumb || "",
      }));

    res.json({ success: true, results });
  } catch (err) {
    console.error("❌ search-food error:", (err as any).message);
    res.status(500).json({ success: false, error: "Search failed" });
  }
});

// ------------------------------------------------------------
// 🚀 Start serveru
// ------------------------------------------------------------
app.listen(port, () => {
  console.log(`✅ FitAI backend running at http://localhost:${port}`);
});

export default app;

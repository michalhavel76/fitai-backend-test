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

// --- test endpointy
app.get("/ping", (req, res) => res.send("pong"));
app.get("/hello", (req, res) => res.send("Hello from FitAI backend!"));

// 📸 1) ANÁLÝZA JÍDLA → ingredience + makra
app.post("/analyze-plate", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image uploaded" });

    // 1️⃣ Vision AI → seznam ingrediencí
    const b64 = fs.readFileSync(req.file.path, { encoding: "base64" });
    const visionResp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a nutritionist. Return a JSON object with an 'ingredients' array listing food items seen on the plate.",
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

        const food = nutriResp.data.foods[0];
        items.push({
          name: food.food_name,
          calories: food.nf_calories,
          protein: food.nf_protein,
          carbs: food.nf_total_carbohydrate,
          fat: food.nf_total_fat,
        });
      } catch (e: any) {
        console.error("Nutritionix error:", e?.message || e);
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

    res.json({ items, totals, ingredients });
  } catch (err: any) {
    console.error(err?.message || err);
    res.status(500).json({ error: "Failed to analyze plate" });
  }
});

// 🤣 2) VTIPNÁ HLÁŠKA → GPT kouká na fotku (one-liner, max 12 slov)
app.post("/funny-message", upload.single("image"), async (req, res) => {
  try {
    const nickname = req.body.nickname || ""; // volitelně od uživatele

    if (!req.file) return res.json({ message: "Analyzuji jídlo..." });

    const b64 = fs.readFileSync(req.file.path, { encoding: "base64" });

    const funnyResp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
          Jsi osobní fitness coach a kámoš.
          Tvoje hlášky musí být:
          - vždy česky,
          - maximálně 2 krátké věty (do 20 slov),
          - sportovní, motivační nebo free-life vibe,
          - žádné metafory, žádné básnění, žádné dlouhé popisy,
          - chval zdravé jídlo ("super fuel na běhání"),
          - pokárej nezdravé ("burger = 5 km běhu navíc"),
          - připomeň, že život je free a občasný cheat meal je ok.
          Používej občas jméno/přezdívku (${nickname}), pokud je k dispozici.
          `,
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Co ty na to jídlo? Řekni mi to free, krátce a sportovně!" },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${b64}` },
            },
          ],
        },
      ],
      max_tokens: 30,
    });

    const funnyMessage =
      funnyResp.choices[0].message.content || "Analyzuji jídlo...";

    console.log("🤖 FunnyMessage:", funnyMessage);
    res.json({ message: funnyMessage });
  } catch (err: any) {
    console.error("Funny-message error:", err?.message || err);
    res.json({ message: "Analyzuji jídlo..." }); // fallback
  }
});

app.listen(port, () => {
  console.log(`✅ FitAI backend running at http://localhost:${port}`);
});

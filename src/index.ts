import express from "express";
import dotenv from "dotenv";
import multer from "multer";
import OpenAI from "openai";

dotenv.config();

const app = express();
const port = process.env.PORT || 8080;

// Multer – ukládáme obrázek do paměti
const upload = multer({ storage: multer.memoryStorage() });

// testovací endpointy
app.get("/ping", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/hello", (req, res) => {
  res.json({ message: "FoodScreen is connected ✅" });
});

app.get("/check-key", async (req, res) => {
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const models = await client.models.list();
    res.json({ status: "ok", firstModel: models.data[0]?.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "API key is not valid" });
  }
});

// analyze-plate – Vision + dummy makra
app.post("/analyze-plate", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    const base64Image = req.file.buffer.toString("base64");

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Identify the main food ingredients with estimated grams." },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${base64Image}` },
            },
          ],
        },
      ],
    });

    const visionRaw = response.choices[0]?.message?.content || "";

    // zatím dummy hodnoty – později databáze
    const result = {
      ingredients: [
        { name: "chicken breast", grams: 150 },
        { name: "rice", grams: 200 },
      ],
      totals: {
        calories: 500,
        protein: 40,
        carbs: 60,
        fat: 10,
      },
      visionRaw,
    };

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to analyze plate" });
  }
});

app.listen(port, () => {
  console.log(`✅ FitAI backend running at http://localhost:${port}`);
});

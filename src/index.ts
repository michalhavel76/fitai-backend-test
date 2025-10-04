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

// ---------------------- /analyze-plate ----------------------
app.post("/analyze-plate", upload.single("image"), async (req, res) => {
  try {
    const imagePath = req.file?.path;
    if (!imagePath) return res.status(400).json({ error: "No image uploaded" });

    // 1️⃣ Recognize ingredients via GPT-4o-mini Vision
    const imageBase64 = fs.readFileSync(imagePath, { encoding: "base64" });

    const gptResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a nutrition assistant. Identify all visible foods in the photo and list them clearly in English, separated by commas.",
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

    // 2️⃣ Get macros from Nutritionix
    let allItems: any[] = [];
    for (const item of ingredients) {
      const foods = await getNutritionixData(item);
      if (foods.length > 0) {
        const f = foods[0];
        allItems.push({
          name: f.food_name,
          calories: f.nf_calories,
          protein: f.nf_protein,
          carbs: f.nf_total_carbohydrate,
          fat: f.nf_total_fat,
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
            "You are a friendly, realistic fitness coach. Write one short, positive comment (max 20 words, 2 emoji max) about the food in the photo. Use second person (you).",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Give a fun, motivational remark:" },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
          ],
        },
      ],
    });

    const message = gptResponse.choices?.[0]?.message?.content || "Great choice! Keep it up! 💪";

    fs.unlinkSync(imagePath);

    return res.json({ message });
  } catch (err: any) {
    console.error("❌ Funny message error:", err.message);
    return res.status(500).json({ message: "You’re doing great, keep going! 💪" });
  }
});

// -----------------------------------------------------------
app.listen(port, () => console.log(`🚀 FitAI backend running on port ${port}`));
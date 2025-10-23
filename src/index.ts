// =======================================================
// FitAI Backend 4.9.9 – Railway-Safe TypeScript Build
// =======================================================

import express from "express";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import OpenAI from "openai";
import axios from "axios";
import { Pool } from "pg";

// 🧩 Routes
import addFood from "./add-food";
import nutrientFill from "./nutrient-fill";
import neverZeroRouter from "./neverzero-engine";

// ⚙️ Temporary safe imports (TS-ignore pro JS moduly)
 // @ts-ignore
import scientificCorrection from "./scientific-correction.js";
 // @ts-ignore
import { scientificCalibrate } from "./scientific-calibration.js";

dotenv.config();

// =======================================================
// 🌍 INIT SERVER + CONFIG
// =======================================================
const app = express();
const PORT = parseInt(process.env.PORT || "8080", 10);

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ limit: "20mb", extended: true }));

// =======================================================
// 🧠 DATABASE CONNECTION (Railway PostgreSQL)
// =======================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool
  .connect()
  .then(() => console.log("🟢 Connected to Railway PostgreSQL"))
  .catch((err) => console.error("🔴 DB error:", err.message));

// =======================================================
// 🧩 PING (Server health check)
// =======================================================
app.get("/ping", (_, res) => {
  res.status(200).json({ status: "ok", message: "FitAI backend active ✅" });
});

// =======================================================
// 🍽️ ANALYZE PLATE (AI + Nutritionix + AutoFill vitamins)
// =======================================================
const upload = multer({ dest: "uploads/" });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post("/analyze-plate", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image provided" });
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

    res.json({ ingredients, count: ingredients.length });
  } catch (err: any) {
    console.error("❌ Analyze error:", err.message);
    res.status(500).json({ error: "Analyze error" });
  }
});

// =======================================================
// 🧬 SCIENTIFIC CALIBRATION (API route)
// =======================================================
app.post("/api/scientific-calibrate", scientificCalibrate);

// =======================================================
// 🔍 ROUTES
// =======================================================
app.use("/api", addFood);
app.use("/api", nutrientFill);
app.use("/api", neverZeroRouter);
app.use("/api", scientificCorrection);

// =======================================================
// 🚀 SERVER START (Railway dynamic port)
// =======================================================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ FitAI Backend 4.9.9 running on port ${PORT}`);
});

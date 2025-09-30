import express from "express";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

// test endpointy
app.get("/ping", (req, res) => res.send("pong"));
app.get("/hello", (req, res) => res.send("Hello from FitAI backend!"));

// ✅ analyze-plate endpoint (zatím jen dummy)
app.post("/analyze-plate", upload.single("image"), async (req, res) => {
  try {
    console.log("📸 Received image:", req.file?.path);

    // TODO: tady připojíme OpenAI Vision + Nutritionix
    // Prozatím dummy data:
    res.json({
      items: [
        { name: "Egg", calories: 155, protein: 13, carbs: 1.1, fat: 11 },
        { name: "Avocado", calories: 160, protein: 2, carbs: 9, fat: 15 }
      ],
      totals: { calories: 315, protein: 15, carbs: 10, fat: 26 }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to analyze plate" });
  }
});

app.listen(port, () => {
  console.log(`✅ FitAI backend running at http://localhost:${port}`);
});

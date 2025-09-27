import express, { Request, Response } from "express";
import multer from "multer";

const app = express();
const PORT = parseInt(process.env.PORT || "8080", 10);

// multer – ukládání fotky do paměti
const upload = multer({ storage: multer.memoryStorage() });

// Healthcheck
app.get("/ping", (req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

// Test
app.get("/hello", (req: Request, res: Response) => {
  res.status(200).json({ message: "FoodScreen is connected ✅" });
});

// 📸 přijme fotku
app.post("/analyze-plate", upload.single("image"), (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: "No image uploaded" });
  }

  res.status(200).json({
    message: "Image received ✅",
    fileName: req.file.originalname,
    size: req.file.size
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Mini-backend běží na portu ${PORT}`);
});

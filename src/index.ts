import express, { Request, Response } from "express";

const app = express();
const PORT = parseInt(process.env.PORT || "8080", 10);

// Healthcheck endpoint
app.get("/ping", (req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

// Root (jen pro test)
app.get("/", (req: Request, res: Response) => {
  res.send("FitAI backend is running ✅");
});

// 🚀 posloucháme na 0.0.0.0
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Mini-backend běží na portu ${PORT}`);
});

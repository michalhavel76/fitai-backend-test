// =======================================================
// FitAI Backend 5.0 – Clean Railway-safe Build
// ✅ Base server + /api/add-food test
// =======================================================

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import addFoodRoute from "./add-food";

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = parseInt(process.env.PORT || "8080", 10);

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// =======================================================
// 🧠 Database connection test
// =======================================================
(async () => {
  try {
    await prisma.$connect();
    console.log("🟢 Connected to Railway PostgreSQL");
  } catch (err: any) {
    console.error("🔴 Database connection failed:", err.message);
  }
})();

// =======================================================
// 🧩 Ping test
// =======================================================
app.get("/ping", (_, res) => {
  res.json({ status: "ok", message: "FitAI 5.0 backend running ✅" });
});

// =======================================================
// 🍎 Add Food endpoint
// =======================================================
app.use("/api", addFoodRoute);

// =======================================================
// 🚀 Start server
// =======================================================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ FitAI Backend 5.0 running on port ${PORT}`);
});

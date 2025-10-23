// =======================================================
// FitAI 5.2 – Dedicated Scientific Fill42 Microserver
// =======================================================

import express from "express";
import dotenv from "dotenv";
import { Pool } from "pg";
import { scientificFill42 } from "./scientific-fill-42";

dotenv.config();
const app = express();
app.use(express.json());

const port = process.env.FILL42_PORT || 4100;

// Připojení na databázi
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.connect()
  .then(() => console.log("🟢 Connected to PostgreSQL (Fill42 Server)"))
  .catch((err) => console.error("🔴 DB Error:", err.message));

// Endpoint pro spuštění Fill42
app.post("/run", async (req, res) => {
  console.log("🧬 Fill42 Standalone endpoint triggered");
  try {
    await scientificFill42(req, res);
  } catch (err: any) {
    console.error("❌ Fill42 error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Start serveru
app.listen(port, () => {
  console.log(`🧬 FitAI Fill42 Standalone running on port ${port}`);
});

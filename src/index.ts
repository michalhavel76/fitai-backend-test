import express from "express";
import multer from "multer";
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import cors from "cors"; // ✅ přidáno

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

// ✅ povolíme CORS pro všechny domény (stačí pro testovací fázi)
app.use(cors());

// ✅ pokud budeš používat JSON body (např. při testech API)
app.use(express.json());

// testovací endpointy
app.get("/ping", (req, res) => {
  res.send("pong");
});

app.get("/hello", (req, res) => {
  res.send("Hello from FitAI backend!");
});

// TODO: tady máš svůj analyze-plate a další endpointy
// importuj je nebo dopiš

app.listen(port, () => {
  console.log(`✅ FitAI backend running at http://localhost:${port}`);
});

"use strict";
// =======================================================
// FitAI 5.2 – Dedicated Scientific Fill42 Microserver
// =======================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const pg_1 = require("pg");
const scientific_fill_42_1 = require("./scientific-fill-42");
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use(express_1.default.json());
const port = process.env.FILL42_PORT || 4100;
// Připojení na databázi
const pool = new pg_1.Pool({
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
        await (0, scientific_fill_42_1.scientificFill42)(req, res);
    }
    catch (err) {
        console.error("❌ Fill42 error:", err.message);
        res.status(500).json({ error: err.message });
    }
});
// Start serveru
app.listen(port, () => {
    console.log(`🧬 FitAI Fill42 Standalone running on port ${port}`);
});

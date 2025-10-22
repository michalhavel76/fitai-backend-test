"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const pg_1 = require("pg");
dotenv_1.default.config();
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});
async function initDB() {
    console.log("🟡 Initializing PostgreSQL tables...");
    try {
        const client = await pool.connect();
        await client.query(`
      CREATE TABLE IF NOT EXISTS foods (
        id SERIAL PRIMARY KEY,
        name_en TEXT,
        name_cz TEXT,
        category TEXT,
        origin TEXT,
        kcal FLOAT,
        protein FLOAT,
        carbs FLOAT,
        fat FLOAT,
        fiber FLOAT,
        sugar FLOAT,
        sodium FLOAT,
        vitamin_a FLOAT,
        vitamin_c FLOAT,
        calcium FLOAT,
        iron FLOAT,
        source TEXT,
        image_url TEXT,
        lang JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
        console.log("✅ PostgreSQL tables initialized successfully.");
        client.release();
    }
    catch (err) {
        console.error("❌ Database init failed:", err.message);
    }
    finally {
        pool.end();
    }
}
initDB();

import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config();

const pool = new Pool({
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
  } catch (err: any) {
    console.error("❌ Database init failed:", err.message);
  } finally {
    pool.end();
  }
}

initDB();

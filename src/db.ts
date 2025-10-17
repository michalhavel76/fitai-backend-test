import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

// ✅ Připojení k Railway PostgreSQL databázi
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.connect()
  .then(() => console.log("✅ Connected to PostgreSQL (Railway)"))
  .catch((err: unknown) => console.error("❌ Database connection error:", err));

export default pool;

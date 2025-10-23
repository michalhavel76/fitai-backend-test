"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const pg_1 = require("pg");
const fs_1 = __importDefault(require("fs"));
dotenv_1.default.config();
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});
async function importFoods() {
    console.log("🍽️ Importing foods into PostgreSQL...");
    try {
        const client = await pool.connect();
        // 1️⃣ Načti data z JSON souboru
        const data = JSON.parse(fs_1.default.readFileSync("src/data/fitai_foods_extended.json", "utf-8"));
        let imported = 0;
        for (const item of data) {
            await client.query(`
        INSERT INTO foods (
          name_en, name_cz, category, origin,
          kcal, protein, carbs, fat, fiber, sugar, sodium,
          vitamin_a, vitamin_c, calcium, iron,
          source, image_url, lang
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, $7, $8, $9, $10, $11,
          $12, $13, $14, $15,
          $16, $17, $18
        )
        ON CONFLICT DO NOTHING;
      `, [
                item.name || item.name_en,
                item.name_cz || item.name,
                item.category || "unknown",
                item.country || "CZ",
                item.energy_kcal || null,
                item.protein_g || null,
                item.carbs_g || null,
                item.fat_g || null,
                item.fiber_g || null,
                item.sugar_g || null,
                item.sodium_mg || null,
                item.vitamins?.vitamin_a_µg || null,
                item.vitamins?.vitamin_c_mg || null,
                item.minerals?.calcium_mg || null,
                item.minerals?.iron_mg || null,
                item.source || "FitAI estimate",
                item.image_url || null,
                JSON.stringify(item.lang || {}),
            ]);
            imported++;
        }
        console.log(`✅ Imported ${imported} foods successfully!`);
        client.release();
    }
    catch (err) {
        console.error("❌ Import failed:", err.message);
    }
    finally {
        pool.end();
    }
}
importFoods();

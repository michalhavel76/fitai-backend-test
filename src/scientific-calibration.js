// =======================================================
// FitAI 4.9.1 – Scientific Calibration + PlateWeight Engine
// Global Food Normalization & Gram Estimation
// Full Production Version – 2025-10-28
// =======================================================

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// =======================================================
// 🧱 AUTO DB CHECK (creates missing columns + audit log)
// =======================================================
async function ensureDatabaseStructure(client) {
  try {
    await client.query(`
      ALTER TABLE foods 
      ADD COLUMN IF NOT EXISTS category TEXT,
      ADD COLUMN IF NOT EXISTS accuracy_score FLOAT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS estimated_weight FLOAT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS density FLOAT DEFAULT 1.0,
      ADD COLUMN IF NOT EXISTS pixel_size FLOAT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS plate_pixels FLOAT DEFAULT 100000,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS food_audit_log (
        id SERIAL PRIMARY KEY,
        food_id INT,
        action TEXT,
        details JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log("🧩 Database structure verified (foods + audit log).");
  } catch (err) {
    console.error("❌ Database structure check failed:", err.message);
  }
}

// =======================================================
// 🔬 SCIENTIFIC RANGES (per 100 g)
// =======================================================
const SCIENTIFIC_RANGES = {
  meat: { kcal: [100, 280], protein: [18, 30], fat: [2, 20], carbs: [0, 5] },
  fish: { kcal: [70, 220], protein: [16, 26], fat: [1, 10], carbs: [0, 2] },
  dairy: { kcal: [40, 120], protein: [3, 9], fat: [1, 7], carbs: [3, 10] },
  vegetable: { kcal: [15, 90], protein: [1, 4], fat: [0, 2], carbs: [3, 10] },
  fruit: { kcal: [30, 90], protein: [0.5, 2], fat: [0, 1], carbs: [8, 20] },
  starch: { kcal: [100, 350], protein: [2, 10], fat: [0, 5], carbs: [15, 60] },
  "bread/cereal": { kcal: [200, 450], protein: [6, 15], fat: [1, 8], carbs: [30, 70] },
  "fat/oil": { kcal: [700, 900], protein: [0, 0], fat: [70, 100], carbs: [0, 0] },
  sweet: { kcal: [300, 550], protein: [1, 4], fat: [5, 25], carbs: [50, 80] },
  drink: { kcal: [0, 80], protein: [0, 2], fat: [0, 2], carbs: [1, 10] },
  sauce: { kcal: [50, 200], protein: [1, 5], fat: [1, 15], carbs: [2, 20] },
};

// =======================================================
// 🧠 CATEGORY DETECTION
// =======================================================
function detectCategory(name) {
  const n = (name || "").toLowerCase();
  if (/(chicken|beef|pork|turkey|ham|meat|steak)/.test(n)) return "meat";
  if (/(fish|salmon|tuna|cod|trout|shrimp)/.test(n)) return "fish";
  if (/(milk|yogurt|cheese|butter|cream)/.test(n)) return "dairy";
  if (/(apple|banana|orange|berry|grape|fruit)/.test(n)) return "fruit";
  if (/(potato|rice|pasta|flour|noodle|starch)/.test(n)) return "starch";
  if (/(bread|cereal|baguette|toast|croissant|oat)/.test(n)) return "bread/cereal";
  if (/(oil|fat|lard|butter|margarine)/.test(n)) return "fat/oil";
  if (/(cake|cookie|sugar|sweet|dessert|chocolate)/.test(n)) return "sweet";
  if (/(juice|cola|soda|water|tea|coffee|drink)/.test(n)) return "drink";
  if (/(ketchup|mayo|sauce|dressing|mustard)/.test(n)) return "sauce";
  if (/(vegetable|carrot|tomato|broccoli|onion|pepper|spinach|lettuce)/.test(n)) return "vegetable";
  return "unknown";
}

// =======================================================
// 📊 ACCURACY CALCULATION
// =======================================================
function getAccuracy(value, [min, max]) {
  if (value == null || isNaN(value)) return 0;
  if (value >= min && value <= max) return 1;
  const diff = value < min ? min - value : value - max;
  const range = max - min;
  return Math.max(0, 1 - diff / range);
}

// =======================================================
// ⚖️ WEIGHT ESTIMATION (from pixel size + density)
// =======================================================
function estimateWeight(pixels, platePixels, category) {
  if (!pixels || !platePixels) return 0;
  const ratio = pixels / platePixels; // poměr ploch
  const plateArea = Math.PI * Math.pow(12.5, 2); // plocha 25 cm talíře (cm²)
  const foodArea = plateArea * ratio;
  const densityMap = {
    meat: 1.05, fish: 1.0, dairy: 0.95, vegetable: 0.3, fruit: 0.6,
    starch: 0.8, "bread/cereal": 0.55, "fat/oil": 0.9, sweet: 0.75, sauce: 0.7
  };
  const density = densityMap[category] || 1.0;
  const heightFactor = 1.5; // cm – průměrná výška vrstvy jídla
  const volume = foodArea * heightFactor;
  const grams = volume * density;
  return Math.round(grams);
}

// =======================================================
// 🧾 MAIN ENGINE
// =======================================================
const scientificCalibrate = async (req, res) => {
  console.log("🧬 Running full scientific calibration across all foods...");
  const client = await pool.connect();

  try {
    await ensureDatabaseStructure(client);
    const allFoods = await client.query("SELECT * FROM foods ORDER BY id ASC");
    const total = allFoods.rows.length;

    let calibrated = 0;
    let totalAccuracy = 0;
    let outliers = 0;

    for (const food of allFoods.rows) {
      const category = detectCategory(food.name_en || food.name_cz || "");
      const ranges = SCIENTIFIC_RANGES[category];
      if (!ranges) continue;

      const kcalAcc = getAccuracy(food.kcal, ranges.kcal);
      const proteinAcc = getAccuracy(food.protein, ranges.protein);
      const fatAcc = getAccuracy(food.fat, ranges.fat);
      const carbsAcc = getAccuracy(food.carbs, ranges.carbs);
      const accuracyScore = Number(
        ((kcalAcc + proteinAcc + fatAcc + carbsAcc) / 4).toFixed(3)
      );

      const estimatedWeight = estimateWeight(
        food.pixel_size || 0,
        food.plate_pixels || 100000,
        category
      );

      totalAccuracy += accuracyScore;
      calibrated++;
      if (accuracyScore < 0.8) outliers++;

      await client.query(
        `UPDATE foods 
         SET category=$1, accuracy_score=$2, estimated_weight=$3, density=$4, updated_at=NOW() 
         WHERE id=$5`,
        [category, accuracyScore, estimatedWeight, 1.0, food.id]
      );

      await client.query(
        `INSERT INTO food_audit_log (food_id, action, details, created_at)
         VALUES ($1,$2,$3,NOW())`,
        [
          food.id,
          "scientific_calibration",
          JSON.stringify({
            category,
            accuracyScore,
            estimatedWeight,
            kcal: food.kcal,
            protein: food.protein,
            fat: food.fat,
            carbs: food.carbs,
          }),
        ]
      );
    }

    const avgAccuracy = calibrated ? totalAccuracy / calibrated : 0;
    const summary = {
      totalFoods: total,
      calibrated,
      outliers,
      averageAccuracy: Number(avgAccuracy.toFixed(3)),
      date: new Date().toISOString(),
    };

    console.log("✅ Calibration finished:", summary);
    res.json(summary);
  } catch (err) {
    console.error("❌ Scientific calibration error:", err);
    res.status(500).json({ error: "Scientific calibration failed" });
  } finally {
    client.release();
  }
};

// =======================================================
// ✅ EXPORT
// =======================================================
module.exports = { scientificCalibrate };

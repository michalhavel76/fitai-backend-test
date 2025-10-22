"use strict";
// =======================================================
// FitAI Backend 4.9 – Scientific Calibration System
// Global Food Normalization & Accuracy Framework
// Full Safe Build – 2025-10-19
// =======================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const fs_1 = __importDefault(require("fs"));
const openai_1 = __importDefault(require("openai"));
const axios_1 = __importDefault(require("axios"));
const pg_1 = require("pg");
// 🌍 Routes
const usda_sync_1 = __importDefault(require("./usda-sync"));
const nutrient_fill_1 = __importDefault(require("./nutrient-fill"));
const datahub_engine_1 = __importDefault(require("./datahub-engine"));
const neverzero_engine_1 = __importDefault(require("./neverzero-engine"));
const search_food_1 = __importDefault(require("./search-food"));
const verify_source_1 = __importDefault(require("./verify-source"));
const normalize_engine_1 = __importDefault(require("./normalize-engine"));
const normalize_engine_2 = __importDefault(require("./normalize-engine"));
const verify_accuracy_1 = __importDefault(require("./verify-accuracy"));
// @ts-ignore – JS module (no declaration)
const scientific_correction_1 = __importDefault(require("./scientific-correction"));
// @ts-ignore – JS module (no declaration)
const scientific_calibration_1 = require("./scientific-calibration");
const manual_fill_42_1 = __importDefault(require("./manual-fill-42"));
const scientific_fill_42_1 = __importDefault(require("./scientific-fill-42"));
// =======================================================
// 🌍 INIT SERVER + CONFIG
// =======================================================
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 4000;
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: "20mb" }));
app.use(express_1.default.urlencoded({ limit: "20mb", extended: true }));
app.use(express_1.default.static("public"));
// =======================================================
// 🧠 DATABASE CONNECTION (Railway PostgreSQL)
// =======================================================
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});
pool
    .connect()
    .then(() => console.log("🟢 Connected to PostgreSQL"))
    .catch((err) => console.error("🔴 DB error:", err.message));
// =======================================================
// ⚙️ BASE CONFIGS
// =======================================================
const upload = (0, multer_1.default)({ dest: "uploads/" });
const openai = new openai_1.default({ apiKey: process.env.OPENAI_API_KEY });
const NUTRITIONIX_APP_ID = process.env.NUTRITIONIX_APP_ID;
const NUTRITIONIX_API_KEY = process.env.NUTRITIONIX_API_KEY;
// =======================================================
// 🧩 PING (Server health check)
// =======================================================
app.get("/ping", (_, res) => res.send("pong"));
// =======================================================
// 🍽️ ANALYZE PLATE (AI + Nutritionix + AutoFill vitamins)
// =======================================================
app.post("/analyze-plate", upload.single("image"), async (req, res) => {
    try {
        if (!req.file)
            return res.status(400).json({ error: "No image" });
        const b64 = fs_1.default.readFileSync(req.file.path, { encoding: "base64" });
        const visionResp = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: "You are a nutrition expert. Return JSON with an 'ingredients' array of foods visible on the plate.",
                },
                {
                    role: "user",
                    content: [
                        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
                    ],
                },
            ],
            response_format: { type: "json_object" },
        });
        const parsed = JSON.parse(visionResp.choices[0].message.content || "{}");
        const ingredients = parsed.ingredients || [];
        const items = [];
        for (const ing of ingredients) {
            const local = await pool.query("SELECT * FROM foods WHERE LOWER(name_en) LIKE LOWER($1) OR LOWER(name_cz) LIKE LOWER($1) LIMIT 1", [`%${ing}%`]);
            if (local.rows.length > 0) {
                items.push(local.rows[0]);
                continue;
            }
            try {
                const nutriResp = await axios_1.default.post("https://trackapi.nutritionix.com/v2/natural/nutrients", { query: ing }, {
                    headers: {
                        "x-app-id": NUTRITIONIX_APP_ID,
                        "x-app-key": NUTRITIONIX_API_KEY,
                        "Content-Type": "application/json",
                    },
                });
                const f = nutriResp.data.foods[0];
                const newFood = {
                    name_en: f.food_name,
                    name_cz: f.food_name,
                    kcal: Number(f.nf_calories),
                    protein: Number(f.nf_protein),
                    carbs: Number(f.nf_total_carbohydrate),
                    fat: Number(f.nf_total_fat),
                    image_url: f.photo?.thumb || null,
                    source: "nutritionix",
                };
                await pool.query(`INSERT INTO foods (name_en, name_cz, kcal, protein, carbs, fat, image_url, source, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`, [
                    newFood.name_en,
                    newFood.name_cz,
                    newFood.kcal,
                    newFood.protein,
                    newFood.carbs,
                    newFood.fat,
                    newFood.image_url,
                    newFood.source,
                ]);
                await axios_1.default.post("http://localhost:4000/api/nutrient-fill", {
                    food: newFood.name_en,
                });
                items.push(newFood);
            }
            catch (err) {
                console.error("Nutritionix error:", err.message);
            }
        }
        const totals = items.reduce((acc, i) => {
            acc.kcal += Number(i.kcal) || 0;
            acc.protein += Number(i.protein) || 0;
            acc.carbs += Number(i.carbs) || 0;
            acc.fat += Number(i.fat) || 0;
            return acc;
        }, { kcal: 0, protein: 0, carbs: 0, fat: 0 });
        res.json({
            items,
            totals: {
                calories: Math.round(totals.kcal),
                protein: Math.round(totals.protein),
                carbs: Math.round(totals.carbs),
                fat: Math.round(totals.fat),
            },
        });
    }
    catch (err) {
        console.error("Analyze error:", err.message);
        res.status(500).json({ error: "Analyze error" });
    }
});
// =======================================================
// 🧬 USDA SYNC (Enhanced Search + 10 results fallback)
// =======================================================
app.post("/usda-sync", async (req, res) => {
    try {
        const { food } = req.body;
        if (!food)
            return res.status(400).json({ error: "Missing food name" });
        const USDA_API_KEY = "CoapVie1RnpUCrfGNfbeoDyG0Ut3DNktWOyLnUC0";
        const USDA_SEARCH_URL = `https://api.nal.usda.gov/fdc/v1/foods/search`;
        console.log("🔎 Searching USDA for:", food);
        const searchRes = await axios_1.default.get(USDA_SEARCH_URL, {
            params: { api_key: USDA_API_KEY, query: food, pageSize: 10 },
        });
        const results = searchRes.data.foods || [];
        if (results.length === 0)
            return res.status(404).json({ error: `No match found in USDA for "${food}"` });
        const fdcId = results[0].fdcId;
        console.log("✅ Found USDA entry:", results[0].description);
        const foodRes = await axios_1.default.get(`https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${USDA_API_KEY}`);
        const foodData = foodRes.data;
        const nutrients = {};
        foodData.foodNutrients?.forEach((n) => {
            const name = n.nutrient?.name?.toLowerCase() || "";
            const val = n.amount || 0;
            if (name.includes("vitamin a"))
                nutrients.vitamin_a = val;
            if (name.includes("vitamin c"))
                nutrients.vitamin_c = val;
            if (name.includes("vitamin d"))
                nutrients.vitamin_d = val;
            if (name.includes("vitamin e"))
                nutrients.vitamin_e = val;
            if (name.includes("vitamin k"))
                nutrients.vitamin_k = val;
            if (name.includes("calcium"))
                nutrients.calcium = val;
            if (name.includes("iron"))
                nutrients.iron = val;
            if (name.includes("zinc"))
                nutrients.zinc = val;
            if (name.includes("magnesium"))
                nutrients.magnesium = val;
            if (name.includes("phosphorus"))
                nutrients.phosphorus = val;
            if (name.includes("potassium"))
                nutrients.potassium = val;
            if (name.includes("copper"))
                nutrients.copper = val;
            if (name.includes("manganese"))
                nutrients.manganese = val;
            if (name.includes("selenium"))
                nutrients.selenium = val;
            if (name.includes("sodium"))
                nutrients.sodium = val;
            if (name.includes("cholesterol"))
                nutrients.cholesterol = val;
            if (name.includes("monounsaturated"))
                nutrients.monounsaturated_fat = val;
            if (name.includes("polyunsaturated"))
                nutrients.polyunsaturated_fat = val;
            if (name.includes("trans"))
                nutrients.trans_fat = val;
            if (name.includes("water"))
                nutrients.water = val;
        });
        await pool.query(`INSERT INTO foods (name_en, name_cz, region, source, is_global, accuracy_score, created_at)
       VALUES ($1,$1,'global','USDA',true,1.0,NOW())
       ON CONFLICT (name_en) DO UPDATE SET region='global', source='USDA', updated_at=NOW()`, [food.toLowerCase()]);
        res.json({ success: true, nutrients });
    }
    catch (err) {
        console.error("❌ USDA Sync Error:", err.message);
        res.status(500).json({ error: "USDA sync failed" });
    }
});
// =======================================================
// 🧬 SCIENTIFIC CALIBRATION & FILL 42 (NEW)
// =======================================================
app.post("/api/scientific-calibrate", scientific_calibration_1.scientificCalibrate);
// 🧩 Scientific Fill 42 – must be before other routes
app.post("/api/scientific-fill-42", scientific_fill_42_1.default);
app.use(manual_fill_42_1.default);
// =======================================================
// 🔍 OTHER ROUTES (after Fill 42)
// =======================================================
app.use("/", usda_sync_1.default);
app.use("/", datahub_engine_1.default);
app.use("/api", nutrient_fill_1.default);
app.use("/", neverzero_engine_1.default);
app.use("/", search_food_1.default);
app.use("/", verify_source_1.default);
app.use("/", normalize_engine_1.default);
app.use("/", normalize_engine_2.default);
app.use("/", verify_accuracy_1.default);
// 🧠 Scientific correction LAST
app.use("/", scientific_correction_1.default);
// =======================================================
// 🚀 SERVER START
// =======================================================
app.listen(port, () => {
    console.log(`✅ FitAI Backend 4.9 running on port ${port}`);
});

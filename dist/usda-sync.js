"use strict";
// ==============================================
// FitAI 4.3.1 – Smart USDA Storage & Premium Logic (Build Safe)
// Fixed for Railway (removed unsupported Prisma JSON fields)
// ==============================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const router = express_1.default.Router();
const USDA_API_KEY = process.env.USDA_API_KEY || "YOUR_USDA_KEY";
const USDA_SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search?api_key=" + USDA_API_KEY;
router.post("/usda-sync", async (req, res) => {
    try {
        const { food, plan = "Basic" } = req.body;
        if (!food)
            return res.status(400).json({ error: "Missing food name" });
        console.log("🔎 Searching USDA for:", food);
        const searchRes = await (0, node_fetch_1.default)(`${USDA_SEARCH_URL}&query=${encodeURIComponent(food)}&pageSize=1`);
        const searchData = await searchRes.json();
        if (!searchData.foods?.length) {
            return res.status(404).json({ error: "No match found in USDA." });
        }
        const fdcId = searchData.foods[0].fdcId;
        console.log("📦 USDA match found, FDC ID:", fdcId);
        const foodRes = await (0, node_fetch_1.default)(`https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${USDA_API_KEY}`);
        const foodData = await foodRes.json();
        const nutrients = {};
        // 🧩 Core nutrient extraction
        foodData.foodNutrients?.forEach((n) => {
            const name = n.nutrient?.name?.toLowerCase() || "";
            const val = n.amount || 0;
            // === BASE (Basic plan – macronutrients) ===
            if (name.includes("energy"))
                nutrients.kcal = val;
            if (name.includes("protein"))
                nutrients.protein = val;
            if (name.includes("carbohydrate"))
                nutrients.carbs = val;
            if (name.includes("total lipid") || name === "fat")
                nutrients.fat = val;
            // === PREMIUM (minerals) ===
            if (["Premium", "Premium+", "Elite"].includes(plan)) {
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
                if (name.includes("sodium"))
                    nutrients.sodium = val;
                if (name.includes("copper"))
                    nutrients.copper = val;
                if (name.includes("manganese"))
                    nutrients.manganese = val;
                if (name.includes("selenium"))
                    nutrients.selenium = val;
            }
            // === PREMIUM+ (vitamins & advanced) ===
            if (["Premium+", "Elite"].includes(plan)) {
                if (name.includes("vitamin a"))
                    nutrients.vitamin_a = val;
                if (name.includes("vitamin b1") || name.includes("thiamin"))
                    nutrients.vitamin_b1 = val;
                if (name.includes("vitamin b2") || name.includes("riboflavin"))
                    nutrients.vitamin_b2 = val;
                if (name.includes("vitamin b3") || name.includes("niacin"))
                    nutrients.vitamin_b3 = val;
                if (name.includes("vitamin b5") || name.includes("pantothenic"))
                    nutrients.vitamin_b5 = val;
                if (name.includes("vitamin b6"))
                    nutrients.vitamin_b6 = val;
                if (name.includes("vitamin b12"))
                    nutrients.vitamin_b12 = val;
                if (name.includes("folate"))
                    nutrients.folate_b9 = val;
                if (name.includes("vitamin c"))
                    nutrients.vitamin_c = val;
                if (name.includes("vitamin d"))
                    nutrients.vitamin_d = val;
                if (name.includes("vitamin e"))
                    nutrients.vitamin_e = val;
                if (name.includes("vitamin k"))
                    nutrients.vitamin_k = val;
                if (name.includes("cholesterol"))
                    nutrients.cholesterol = val;
                if (name.includes("fatty acids, total monounsaturated"))
                    nutrients.monounsaturated_fat = val;
                if (name.includes("fatty acids, total polyunsaturated"))
                    nutrients.polyunsaturated_fat = val;
                if (name.includes("fatty acids, total trans"))
                    nutrients.trans_fat = val;
                if (name.includes("water"))
                    nutrients.water = val;
            }
        });
        // 🧾 Audit meta (už bez JSON pole – string verze)
        const auditNote = `USDA sync at ${new Date().toISOString()} [Plan: ${plan}, FDC: ${fdcId}]`;
        // 🧩 Check if record already exists
        const existing = await prisma.foods.findFirst({
            where: { name_en: food.toLowerCase() },
        });
        let updated;
        if (existing) {
            updated = await prisma.foods.update({
                where: { id: existing.id },
                data: {
                    ...nutrients,
                    source: "USDA",
                    accuracy_score: 1.0,
                    lang: { note: auditNote }, // 👈 uložíme audit poznámku do JSON pole lang
                    created_at: new Date(),
                },
            });
            console.log("♻️ Updated existing food:", updated.name_en);
        }
        else {
            updated = await prisma.foods.create({
                data: {
                    name_en: food.toLowerCase(),
                    name_cz: food.toLowerCase(),
                    ...nutrients,
                    source: "USDA",
                    region: "global",
                    is_global: true,
                    accuracy_score: 1.0,
                    lang: { note: auditNote },
                    created_at: new Date(),
                },
            });
            console.log("🆕 Created new food:", updated.name_en);
        }
        res.json({
            success: true,
            data: updated,
            plan_applied: plan,
            nutrients_found: Object.keys(nutrients).length,
        });
    }
    catch (err) {
        console.error("❌ USDA Sync Error:", err.message);
        res.status(500).json({ error: "Internal Server Error" });
    }
});
exports.default = router;
// ==============================================
// END – FitAI 4.3.1 Smart USDA Storage & Premium Logic
// ==============================================

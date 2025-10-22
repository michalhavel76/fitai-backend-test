"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// =======================================================
// FitAI 4.4 – Accuracy Verification (Scientific Audit)
// =======================================================
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const router = express_1.default.Router();
router.get("/api/verify-accuracy", async (_, res) => {
    try {
        const foods = await prisma.foods.findMany();
        let macroOk = 0;
        let microOk = 0;
        let macroTotal = 0;
        let microTotal = 0;
        const outliers = [];
        for (const f of foods) {
            // --- ✅ Makroživiny ---
            const macros = ["kcal", "protein", "carbs", "fat"];
            for (const key of macros) {
                const val = Number(f[key]);
                if (!val || val <= 0)
                    continue;
                macroTotal++;
                if (val < 1000 && val > 0)
                    macroOk++;
                else
                    outliers.push({ id: f.id, food: f.name_en, issue: `${key}=${val}` });
            }
            // --- ✅ Mikroživiny ---
            const micros = [
                "iron", "zinc", "vitamin_d", "vitamin_e", "vitamin_k",
                "magnesium", "phosphorus", "potassium", "calcium", "selenium",
                "vitamin_c", "vitamin_a", "vitamin_b12", "vitamin_b6"
            ];
            for (const key of micros) {
                const val = Number(f[key]);
                if (!val || val <= 0)
                    continue;
                microTotal++;
                // očekávaný rozumný rozsah na 100 g
                const limits = {
                    iron: [0, 30],
                    zinc: [0, 10],
                    vitamin_d: [0, 20],
                    vitamin_e: [0, 20],
                    vitamin_k: [0, 500],
                    magnesium: [0, 200],
                    phosphorus: [0, 600],
                    potassium: [0, 1000],
                    calcium: [0, 300],
                    selenium: [0, 100],
                    vitamin_c: [0, 100],
                    vitamin_a: [0, 1000],
                    vitamin_b12: [0, 5],
                    vitamin_b6: [0, 2],
                };
                const [min, max] = limits[key];
                if (val >= min && val <= max)
                    microOk++;
                else
                    outliers.push({ id: f.id, food: f.name_en, issue: `${key}=${val}` });
            }
        }
        const macroAccuracy = +((macroOk / macroTotal) * 100).toFixed(1);
        const microAccuracy = +((microOk / microTotal) * 100).toFixed(1);
        const overall = +(((macroAccuracy + microAccuracy) / 2).toFixed(1));
        res.json({
            totalFoods: foods.length,
            macroAccuracy,
            microAccuracy,
            overallAccuracy: overall,
            outlierCount: outliers.length,
            outlierSamples: outliers.slice(0, 5),
            message: "Scientific FitAI Audit completed ✅"
        });
    }
    catch (err) {
        console.error("❌ Verify Accuracy Error:", err.message);
        res.status(500).json({ error: "Verification failed" });
    }
});
exports.default = router;

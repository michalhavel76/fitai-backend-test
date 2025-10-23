"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveLocalFood = saveLocalFood;
const fs_1 = __importDefault(require("fs"));
const DB_PATH = "src/data/fitai_foods_extended.json";
/**
 * Uloží nové jídlo do FitAI databáze (pokud tam ještě není)
 */
function saveLocalFood(food) {
    try {
        const raw = fs_1.default.readFileSync(DB_PATH, "utf-8");
        const foods = JSON.parse(raw);
        // už existuje?
        const exists = foods.some((f) => f.name.toLowerCase() === food.name.toLowerCase());
        if (exists) {
            console.log(`ℹ️ Food already exists: ${food.name}`);
            return;
        }
        foods.push(food);
        fs_1.default.writeFileSync(DB_PATH, JSON.stringify(foods, null, 2));
        console.log(`💾 New food saved: ${food.name}`);
    }
    catch (err) {
        console.error("❌ Error saving food:", err.message);
    }
}

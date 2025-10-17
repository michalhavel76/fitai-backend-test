import fs from "fs";

const DB_PATH = "src/data/fitai_foods_extended.json";

/**
 * Uloží nové jídlo do FitAI databáze (pokud tam ještě není)
 */
export function saveLocalFood(food: any) {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf-8");
    const foods = JSON.parse(raw);

    // už existuje?
    const exists = foods.some(
      (f: any) => f.name.toLowerCase() === food.name.toLowerCase()
    );

    if (exists) {
      console.log(`ℹ️ Food already exists: ${food.name}`);
      return;
    }

    foods.push(food);
    fs.writeFileSync(DB_PATH, JSON.stringify(foods, null, 2));
    console.log(`💾 New food saved: ${food.name}`);
  } catch (err) {
    console.error("❌ Error saving food:", (err as any).message);
  }
}

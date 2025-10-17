import fs from "fs";

// 🧠 Cesta k databázi
const DB_PATH = "src/data/fitai_foods_extended.json";

// 📦 Cache v paměti
let localFoods: any[] = [];

// 🔄 Načti databázi z disku
function loadDatabase() {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf-8");
    localFoods = JSON.parse(raw);
    console.log(`✅ FitAI DB loaded (${localFoods.length} foods)`);
  } catch (err) {
    console.error("❌ Error loading FitAI DB:", (err as any).message);
    localFoods = [];
  }
}

// 🚀 Načteme databázi při startu
loadDatabase();

// 🕵️‍♂️ Sleduj změny souboru a při úpravě ho znovu načti
fs.watchFile(DB_PATH, () => {
  console.log("♻️ FitAI DB updated – reloading...");
  loadDatabase();
});

// 🔍 Jednoduchý výpočet podobnosti textů
function stringSimilarity(a: string, b: string) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  if (a === b) return 1;

  const aWords = a.split(" ");
  const bWords = b.split(" ");

  const matches = aWords.filter((word) =>
    bWords.some((bw) => bw.startsWith(word.slice(0, 3)))
  );

  return matches.length / Math.max(aWords.length, bWords.length);
}

// 🔍 Najde nejpodobnější jídlo podle názvu
export function findLocalFood(foodName: string) {
  const name = foodName.toLowerCase();

  // 1️⃣ Přímé nalezení
  let found = localFoods.find((f: any) =>
    name.includes(f.name.toLowerCase())
  );
  if (found) return found;

  // 2️⃣ Fuzzy porovnání
  let bestMatch = null;
  let bestScore = 0;

  for (const f of localFoods) {
    const score = stringSimilarity(name, f.name);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = f;
    }
  }

  if (bestScore > 0.4) {
    console.log(
      `🔎 Fuzzy match: "${foodName}" ≈ "${bestMatch.name}" (score: ${bestScore.toFixed(2)})`
    );
    return bestMatch;
  }

  return null;
}

// src/translate.ts

import OpenAI from "openai";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// 1️⃣ Načti jazyky z databáze
async function getLanguages() {
  return prisma.languages.findMany({
    orderBy: { id: "asc" },
  });
}

// 2️⃣ Hlavní funkce – překlad názvu potraviny do všech jazyků
export async function translateFoodName(foodId: number, englishName: string) {
  const languages = await getLanguages();

  // Seznam jazyků pro API prompt
  const translationTargets = languages
    .filter((lang) => lang.code !== "en")
    .map((lang) => `${lang.name} (${lang.code})`)
    .join(", ");

  // 3️⃣ Jeden obrovský prompt = všechny jazyky najednou
  const prompt = `
You are a professional food translation engine.
Translate the food name "${englishName}" into the following languages:

${translationTargets}

Return JSON in this structure:
{
  "translations": {
    "de": "...",
    "fr": "...",
    "es": "...",
    "it": "...",
    "cz": "...",
    "pt": "...",
    "ar": "...",
    "ru": "...",
    "zh_CN": "...",
    "pl": "...",
    "jp": "...",
    "kr": "...",
    "nl": "...",
    "se": "..."
  }
}

Do not add comments. Translate food as a food item.
`;

  // 4️⃣ Pošli do OpenAI najednou
  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Always return clean JSON." },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  });

  // 5️⃣ Parse odpovědi
  const raw = response.choices[0].message.content || "{}";
  const data = JSON.parse(raw);

  if (!data.translations) {
    throw new Error("Invalid translation response");
  }

  // 6️⃣ Uložení do databáze – upsert = bez duplicit
  let saved = 0;

  for (const lang of languages) {
    const translatedName =
      lang.code === "en"
        ? englishName
        : data.translations[lang.code] || englishName;

    await prisma.food_translations.upsert({
      where: {
        food_id_language_id: {
          food_id: foodId,
          language_id: lang.id,
        },
      },
      update: { name: translatedName },
      create: {
        food_id: foodId,
        language_id: lang.id,
        name: translatedName,
      },
    });

    saved++;
  }

  return {
    success: true,
    saved,
    languages: languages.length,
  };
}

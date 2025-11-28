// src/translate.ts

import OpenAI from "openai";
import { prisma } from "../prisma/client";  // ✔ správný import pro Prisma 7

// OpenAI klient
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// 1️⃣ Načtení jazyků z databáze
async function getLanguages() {
  return prisma.languages.findMany({
    orderBy: { id: "asc" },
  });
}

// 2️⃣ Hlavní funkce – překlad názvu potraviny do všech jazyků
export async function translateFoodName(foodId: number, englishName: string) {
  const languages = await getLanguages();

  // Seznam jazyků do promptu (bez EN)
  const translationTargets = languages
    .filter((lang) => lang.code !== "en")
    .map((lang) => `${lang.name} (${lang.code})`)
    .join(", ");

  // 3️⃣ Prompt pro hromadný překlad
  const prompt = `
You are a professional food translation engine.
Translate the food name "${englishName}" into the following languages:

${translationTargets}

Return JSON in the following format:
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

Do NOT add comments or explanations.
Translate only the food name.
`;

  // 4️⃣ OpenAI požadavek
  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Always return clean JSON only." },
      { role: "user", content: prompt },
    ],
    temperature: 0,
    response_format: { type: "json_object" },
  });

  // 5️⃣ Parse JSON
  const raw = response.choices[0].message.content || "{}";
  const data = JSON.parse(raw);

  if (!data.translations) {
    throw new Error("Invalid translation JSON received from OpenAI.");
  }

  // 6️⃣ Uložení překladů do DB přes UPSERT
  let saved = 0;

  for (const lang of languages) {
    const translated =
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
      update: { name: translated },
      create: {
        food_id: foodId,
        language_id: lang.id,
        name: translated,
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

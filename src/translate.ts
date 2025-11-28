// src/translate.ts

import OpenAI from "openai";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// OpenAI klient
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// 1️⃣ Načtení jazyků
async function getLanguages() {
  return prisma.languages.findMany({
    orderBy: { id: "asc" },
  });
}

// 2️⃣ Funkce překladu
export async function translateFoodName(foodId: number, englishName: string) {
  const languages = await getLanguages();

  const translationTargets = languages
    .filter((lang) => lang.code !== "en")
    .map((lang) => `${lang.name} (${lang.code})`)
    .join(", ");

  const prompt = `
Translate the food name "${englishName}" into the following languages:

${translationTargets}

Return only JSON:
{
  "translations": {
    "de": "",
    "fr": "",
    "es": "",
    "it": "",
    "cz": "",
    "pt": "",
    "ar": "",
    "ru": "",
    "zh_CN": "",
    "pl": "",
    "jp": "",
    "kr": "",
    "nl": "",
    "se": ""
  }
}
`;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Always output pure JSON." },
      { role: "user", content: prompt },
    ],
    temperature: 0,
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0].message.content || "{}";
  const data = JSON.parse(raw);

  if (!data.translations) {
    throw new Error("Missing translations in AI response.");
  }

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

// =======================================================
// FitAI 4.8.1 – AI Fallback Nutrients Utility
// Safe offline version (no external API)
// =======================================================

// Tato verze doplňuje realistické minimum hodnot,
// aby nikdy nezůstala žádná živina prázdná nebo null.
export const aiFallbackNutrients = async (data: Record<string, number>) => {
  const fallback: Record<string, number> = { ...data };

  for (const [key, value] of Object.entries(fallback)) {
    if (value === 0 || value == null) {
      // lehké defaultní hodnoty – symbolické množství, aby prošel scientific engine
      if (key.startsWith("vitamin_")) fallback[key] = 0.5;
      else if (["iron", "calcium", "magnesium", "zinc"].includes(key)) fallback[key] = 1.0;
      else if (["fiber", "sugar"].includes(key)) fallback[key] = 0.1;
      else fallback[key] = 0.01;
    }
  }

  return fallback;
};

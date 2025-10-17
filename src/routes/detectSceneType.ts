/* ========================================================================== */
/* 🧠 TEST DETEKCE (s logy)                                                  */
/* ========================================================================== */
app.post("/detectSceneType", async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ success: false, message: "No image" });

    console.log("📥 Obrázek přijat z appky:", image.substring(0, 60));

    let aiResult = "meal";
    let raw = "";

    try {
      const ai = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
              You are an image classifier for a nutrition app.
              Reply with only one word: "meal" or "product".
            `,
          },
          {
            role: "user",
            content: [{ type: "image_url", image_url: { url: image } }],
          },
        ],
      });

      raw = ai.choices[0]?.message?.content?.toLowerCase()?.trim() || "";
      console.log("🧠 RAW ODPOVĚĎ OPENAI:", raw);

      if (raw.includes("product")) aiResult = "product";
      else if (raw.includes("meal")) aiResult = "meal";
    } catch (e: any) {
      console.error("❌ Chyba v OpenAI části:", e.message);
    }

    console.log("📤 Výsledek pro appku:", aiResult);

    res.json({ success: true, type: aiResult });
  } catch (err: any) {
    console.error("❌ Celková chyba detectSceneType:", err.message);
    res.json({ success: false, type: "meal" });
  }
});

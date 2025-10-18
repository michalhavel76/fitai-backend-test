import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🧹 Searching for duplicate foods by name_en...");

  const duplicates = await prisma.$queryRawUnsafe<
    { name_en: string; count: number }[]
  >(`
    SELECT name_en, COUNT(*)::int AS count
    FROM foods
    WHERE name_en IS NOT NULL
    GROUP BY name_en
    HAVING COUNT(*) > 1;
  `);

  if (duplicates.length === 0) {
    console.log("✅ No duplicates found. All good!");
    return;
  }

  console.log(`⚠️ Found ${duplicates.length} duplicates:`);
  for (const d of duplicates) {
    console.log(` - ${d.name_en} (${d.count}x)`);

    // ponecháme jen jeden záznam a smažeme ostatní
    await prisma.$executeRawUnsafe(`
      DELETE FROM foods
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM foods
        WHERE name_en = '${d.name_en.replace(/'/g, "''")}'
        GROUP BY name_en
      )
      AND name_en = '${d.name_en.replace(/'/g, "''")}';
    `);
  }

  console.log("🧽 Duplicates cleaned!");
}

main()
  .catch((e) => console.error("❌ Error:", e.message))
  .finally(async () => await prisma.$disconnect());

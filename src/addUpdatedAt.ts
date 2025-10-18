import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("⏳ Re-adding 'updated_at' column to foods table...");

  await prisma.$executeRawUnsafe(`
    ALTER TABLE foods
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
  `);

  console.log("✅ Column 'updated_at' restored successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Error restoring column:", e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

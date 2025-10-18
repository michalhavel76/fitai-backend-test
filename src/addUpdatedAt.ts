import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("⏳ Adding 'updated_at' column to foods table...");

  await prisma.$executeRawUnsafe(`
    ALTER TABLE foods
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
  `);

  console.log("✅ Column 'updated_at' added successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Error adding column:", e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

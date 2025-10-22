"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    console.log("🧩 Creating UNIQUE constraint on name_en...");
    // PostgreSQL neumí IF NOT EXISTS přímo v ADD CONSTRAINT, proto kontrolujeme ručně
    const exists = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS count
    FROM pg_constraint
    WHERE conname = 'unique_name_en';
  `);
    if (exists[0].count > 0) {
        console.log("ℹ️ UNIQUE constraint already exists, skipping.");
    }
    else {
        await prisma.$executeRawUnsafe(`
      ALTER TABLE foods
      ADD CONSTRAINT unique_name_en UNIQUE (name_en);
    `);
        console.log("✅ UNIQUE constraint created successfully!");
    }
}
main()
    .catch((e) => {
    console.error("❌ Error:", e.message);
})
    .finally(async () => {
    await prisma.$disconnect();
});

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
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

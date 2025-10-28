// clearFoods.js
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

(async () => {
  try {
    const deleted = await prisma.foods.deleteMany();
    console.log(`✅ Deleted ${deleted.count} records from "foods"`);
  } catch (err) {
    console.error("❌ Error deleting foods:", err);
  } finally {
    await prisma.$disconnect();
  }
})();

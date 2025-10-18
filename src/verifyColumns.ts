import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const result = await prisma.$queryRawUnsafe(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'foods';
  `);

  console.log("📋 Columns in 'foods' table:");
  console.table(result);
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());

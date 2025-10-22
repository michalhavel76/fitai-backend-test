"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
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

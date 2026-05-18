import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const username = process.env.DEFAULT_USERNAME || 'admin';
  const rawPassword = process.env.DEFAULT_PASSWORD || 'admin123';
  
  // Creating a simple SHA-256 hash for the password
  // (You could switch to bcrypt later if preferred)
  const passwordHash = crypto.createHash('sha256').update(rawPassword).digest('hex');

  const user = await prisma.user.upsert({
    where: { username },
    update: {
      password: passwordHash,
    },
    create: {
      username,
      password: passwordHash,
    },
  });

  console.log(`Seeded user: ${user.username}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

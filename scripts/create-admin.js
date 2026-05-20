import prisma, { disconnect } from "../shared/db/client.js";
import crypto from "crypto";

async function main() {
  const email = "admin@kc.com";
  const rawPassword = "admin123";
  const passwordHash = crypto.createHash("sha256").update(rawPassword).digest("hex");

  console.log("Seeding admin user...");

  let user;
  try {
    user = await prisma.user.upsert({
      where: { email },
      update: { password: passwordHash },
      create: {
        id: 1, // Enforce id: 1 for single-user mapping
        email,
        password: passwordHash,
      },
    });
    console.log(`Successfully seeded admin user with email: ${user.email} (ID: ${user.id})`);
  } catch (err) {
    // If the schema change hasn't been pushed yet, fallback to username
    if (err.message?.includes("Unknown field") || err.message?.includes("email")) {
      console.log("Email field not found in User model. Retrying with username field...");
      user = await prisma.user.upsert({
        where: { username: email },
        update: { password: passwordHash },
        create: {
          id: 1,
          username: email,
          password: passwordHash,
        },
      });
      console.log(`Successfully seeded admin user with username: ${user.username} (ID: ${user.id})`);
    } else {
      throw err;
    }
  }
}

main()
  .catch((e) => {
    console.error("Failed to seed admin user:", e);
    process.exit(1);
  })
  .finally(async () => {
    await disconnect();
  });

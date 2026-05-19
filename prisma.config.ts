import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "shared/db/schema/",
  datasource: {
    url: env("DATABASE_URL"),
  },
});

import { defineConfig } from "prisma/config";

const directUrl = process.env.DIRECT_URL;
const databaseUrl = process.env.DATABASE_URL;

const url = directUrl || databaseUrl;

if (!url) {
  throw new Error(
    "Missing database connection: neither DIRECT_URL nor DATABASE_URL is set"
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url,
  },
});

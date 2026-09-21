import fs from "fs";
import path from "path";
import { execSync } from "child_process";

async function main() {
  const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
  const tempSchemaPath = path.join(process.cwd(), "prisma", "schema-temp.prisma");
  const genClientPath = path.join(process.cwd(), "prisma", "temp-client");
  const targetClientPath = path.join(process.cwd(), "node_modules", ".prisma", "client");

  const schemaContent = fs.readFileSync(schemaPath, "utf-8");
  const modifiedSchema = schemaContent.replace(
    'provider = "prisma-client-js"',
    'provider = "prisma-client-js"\n  output = "./temp-client"'
  );

  fs.writeFileSync(tempSchemaPath, modifiedSchema, "utf-8");

  try {
    console.log("Generating temporary Prisma client...");
    execSync(`npx prisma generate --schema="${tempSchemaPath}"`, { stdio: "inherit" });

    console.log("Copying generated type definitions to node_modules/.prisma/client and node_modules/@prisma/client...");
    const targetPrismaClientPath = path.join(process.cwd(), "node_modules", "@prisma", "client");
    const files = fs.readdirSync(genClientPath);
    for (const f of files) {
      if (f.endsWith(".d.ts") || f.endsWith(".js") || f.endsWith(".mjs")) {
        fs.copyFileSync(path.join(genClientPath, f), path.join(targetClientPath, f));
        fs.copyFileSync(path.join(genClientPath, f), path.join(targetPrismaClientPath, f));
      }
    }
    console.log("Successfully updated Prisma client types in both locations!");
  } finally {
    if (fs.existsSync(tempSchemaPath)) {
      fs.unlinkSync(tempSchemaPath);
    }
    if (fs.existsSync(genClientPath)) {
      fs.rmSync(genClientPath, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error("Failed to generate types:", err);
  process.exit(1);
});

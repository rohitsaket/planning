// Creates or updates a user. The password is read from NEW_USER_PASSWORD, or generated and
// printed ONCE with --generate. It is never written to disk or to the audit log.
// Usage: NEW_USER_PASSWORD='…' npx tsx scripts/create-user.ts <username> <ROLE> "<Display Name>" [email]
//        npx tsx scripts/create-user.ts <username> <ROLE> "<Display Name>" --generate
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword, PASSWORD_MIN_LENGTH } from "../src/lib/auth/password";
import { isRole, ROLES } from "../src/lib/auth/permissions";

if (typeof (process as any).loadEnvFile === "function") {
  try { (process as any).loadEnvFile(); } catch {}
}

const args = process.argv.slice(2).filter((a) => a !== "--generate");
const generate = process.argv.includes("--generate");
const [username, role, displayName, email] = args;
if (!username || !role || !displayName) {
  console.error('Usage: npx tsx scripts/create-user.ts <username> <ROLE> "<Display Name>" [email] [--generate]');
  process.exit(2);
}
if (!/^[a-z0-9._-]{3,50}$/.test(username)) throw new Error("username: 3-50 chars of a-z 0-9 . _ -");
if (!isRole(role)) throw new Error(`role must be one of: ${ROLES.join(", ")}`);
const password = generate ? randomBytes(18).toString("base64url") : process.env.NEW_USER_PASSWORD;
if (!password || password.length < PASSWORD_MIN_LENGTH) throw new Error(`Set NEW_USER_PASSWORD (min ${PASSWORD_MIN_LENGTH} chars) or pass --generate`);

async function run() {
  const db = new PrismaClient();
  const passwordHash = await hashPassword(password!);
  const user = await db.user.upsert({
    where: { username },
    create: { username, role, displayName, email: email || null, passwordHash },
    update: { role, displayName, email: email || null, passwordHash, status: "ACTIVE", failedLoginCount: 0, lockedUntil: null },
  });
  await db.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await db.auditLog.create({ data: { actor: "cli", action: "USER_UPSERT_CLI", entity: "User", entityId: user.id, after: JSON.stringify({ username, role }) } });
  console.log(`user ${username} (${role}) ready`);
  if (generate) console.log(`generated password (shown once): ${password}`);
  await db.$disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

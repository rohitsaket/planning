import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword, PASSWORD_MIN_LENGTH } from "../src/lib/auth/password";

if (typeof (process as any).loadEnvFile === "function") {
  try { (process as any).loadEnvFile(); } catch {}
}

const args = process.argv.slice(2).filter((a) => a !== "--generate");
const generate = process.argv.includes("--generate");
const [username, role, displayName, email] = args;
if (!username || !role || !displayName) {
  console.error('Usage: npm run user:create -- <username> <ROLE> "<Display Name>" [email] [--generate]');
  process.exit(2);
}
if (!/^[a-z0-9._-]{3,50}$/.test(username)) throw new Error("username: 3-50 chars of a-z 0-9 . _ -");
if (!/^[A-Z0-9_]{1,64}$/.test(role)) throw new Error("role must be a role code such as SUPER_ADMIN");
const password = generate ? randomBytes(18).toString("base64url") : process.env.NEW_USER_PASSWORD;
if (!password || password.length < PASSWORD_MIN_LENGTH) throw new Error(`Set NEW_USER_PASSWORD (min ${PASSWORD_MIN_LENGTH} chars) or pass --generate`);

async function main() {
  const db = new PrismaClient();
  try {
    const passwordHash = await hashPassword(password!);
    const user = await db.$transaction(async (tx) => {
      const u = await tx.user.upsert({
        where: { username },
        create: { username, role, displayName, email: email || null, passwordHash, passwordChangedAt: new Date() },
        update: {
          role,
          displayName,
          email: email || null,
          passwordHash,
          status: "ACTIVE",
          failedLoginCount: 0,
          lockedUntil: null,
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          deactivatedAt: null,
          suspendedAt: null,
          version: { increment: 1 },
        },
      });
      const roleRow = await tx.role.findUnique({ where: { code: role! }, select: { id: true, status: true } });
      if (!roleRow) throw new Error(`role ${role} has no Role record — run \`prisma migrate deploy\` first`);
      if (roleRow.status !== "ACTIVE") throw new Error(`role ${role} is not active`);
      await tx.userRole.deleteMany({ where: { userId: u.id } });
      await tx.userRole.create({
        data: { userId: u.id, roleId: roleRow.id, reason: "Assigned from the local administration CLI" },
      });
      await tx.auditLog.create({
        data: {
          actor: "cli",
          action: "USER_UPSERT_CLI",
          entity: "User",
          entityId: u.id,
          after: JSON.stringify({ username, role }),
          outcome: "SUCCESS",
          category: "SECURITY",
        },
      });
      return u;
    });
    await db.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    console.log(`user ${username} (${role}) ready`);
    if (generate) console.log(`generated password (shown once): ${password}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

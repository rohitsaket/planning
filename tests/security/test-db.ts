// The security tests only ever run against a database whose name is exactly SECTEST_DB.
export const SECTEST_DB = "planning_sectest";

export function sectestUrl(): string {
  const base = process.env.SECTEST_BASE_URL || process.env.DATABASE_URL;
  if (!base || !/^postgres(ql)?:\/\//.test(base)) throw new Error("DATABASE_URL must be a PostgreSQL URL");
  const u = new URL(base);
  u.pathname = `/${SECTEST_DB}`;
  return u.toString();
}

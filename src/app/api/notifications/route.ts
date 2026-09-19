import { db } from "@/lib/db";
import { ok } from "@/lib/api-utils";

export async function GET() {
  const notifs = await db.notification.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  return ok({
    rows: notifs.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      severity: n.severity,
      read: n.read,
      createdAt: n.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { id, read } = body;
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  const n = await db.notification.update({ where: { id }, data: { read: !!read } });
  return ok({ id: n.id, read: n.read });
}

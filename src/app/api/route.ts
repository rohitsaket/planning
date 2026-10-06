import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/with-api";

export const GET = withApi({ public: true }, async () => NextResponse.json({ status: "ok" }));

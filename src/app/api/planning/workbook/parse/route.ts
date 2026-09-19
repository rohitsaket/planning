import { NextResponse } from "next/server";
import { parseWorkbook } from "@/lib/domain/workbook-parser";

// POST a .xlsx file for parsing — implements the confirmed workbook contract (spec §31-43)
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file uploaded. Use multipart/form-data with a 'file' field." }, { status: 400 });
    }

    // XLSX security (spec §92)
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith(".xlsx")) {
      return NextResponse.json({ error: "Only .xlsx files are allowed" }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "File exceeds 10MB limit" }, { status: 413 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const result = parseWorkbook(arrayBuffer);

    return NextResponse.json({
      fileName: file.name,
      fileSize: file.size,
      parsedAt: new Date().toISOString(),
      ...result,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: `Workbook parse failed: ${msg}` }, { status: 500 });
  }
}

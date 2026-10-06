import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "./harness";
import { DataTable, type Column } from "@/components/diamond/shared/data-table";
import { parseTableLayout, readTableLayout, reconcileColumnOrder, tableLayoutStorageKey } from "@/components/diamond/shared/table-layout";

type Row = { a: string; b: string; c: string; d: string };
const col = (key: keyof Row, header: string): Column<Row> => ({ key, header, cell: (r) => r[key] });
const COLUMNS = [col("a", "Alpha"), col("b", "Bravo"), col("c", "Charlie")];
const ROWS: Row[] = [{ a: "a1", b: "b1", c: "c1", d: "d1" }];

function withStorage<T>(stored: Record<string, string> | "throws", work: () => T): T {
  const g = globalThis as { window?: unknown };
  const previous = g.window;
  const localStorage = {
    getItem: (k: string) => {
      if (stored === "throws") throw new Error("storage blocked");
      return stored[k] ?? null;
    },
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  g.window = { localStorage };
  try {
    return work();
  } finally {
    if (previous === undefined) delete g.window;
    else g.window = previous;
  }
}

function headers(columns: Column<Row>[], tableId?: string): string[] {
  const html = renderToStaticMarkup(createElement(DataTable<Row>, { columns, rows: ROWS, tableId }));
  const head = html.slice(html.indexOf("<thead"), html.indexOf("</thead>"));
  return [...head.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim()).filter((t) => ["Alpha", "Bravo", "Charlie", "Delta"].includes(t));
}

describe("column order follows the current columns", () => {
  test("a column added by the caller is appended; a removed one disappears; the user's order is kept", () => {
    expect(reconcileColumnOrder([], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
    expect(reconcileColumnOrder(["c", "a", "b"], ["a", "b", "c", "d"])).toEqual(["c", "a", "b", "d"]);
    expect(reconcileColumnOrder(["c", "a", "b"], ["a", "c"])).toEqual(["c", "a"]);
  });

  test("unknown and repeated saved keys are ignored", () => {
    expect(reconcileColumnOrder(["zz", "b", "b", "a"], ["a", "b", "c"])).toEqual(["b", "a", "c"]);
  });
});

describe("saved layout", () => {
  test("only well-formed parts of a stored layout are used", () => {
    expect(parseTableLayout(null)).toEqual({ orderedKeys: [], hiddenKeys: [], colWidths: {} });
    expect(parseTableLayout("{not json")).toEqual({ orderedKeys: [], hiddenKeys: [], colWidths: {} });
    expect(parseTableLayout('"a string"')).toEqual({ orderedKeys: [], hiddenKeys: [], colWidths: {} });
    expect(parseTableLayout(JSON.stringify({ orderedKeys: ["b", 7, null, "a"], hiddenKeys: "c", colWidths: { a: 120, b: -5, c: "wide", d: Infinity } })))
      .toEqual({ orderedKeys: ["b", "a"], hiddenKeys: [], colWidths: { a: 120 } });
  });

  test("the table opens with the saved order and hidden columns", () => {
    const stored = { [tableLayoutStorageKey("orders")]: JSON.stringify({ orderedKeys: ["c", "a", "b"], hiddenKeys: ["b"], colWidths: {} }) };
    expect(withStorage(stored, () => headers(COLUMNS, "orders"))).toEqual(["Charlie", "Alpha"]);
  });

  test("a saved layout naming columns that no longer exist, or missing new ones, still shows every current column", () => {
    const stored = { [tableLayoutStorageKey("orders")]: JSON.stringify({ orderedKeys: ["gone", "c", "a"], hiddenKeys: ["gone"] }) };
    expect(withStorage(stored, () => headers([...COLUMNS, col("d", "Delta")], "orders"))).toEqual(["Charlie", "Alpha", "Bravo", "Delta"]);
  });

  test("no tableId, nothing saved, or unreadable storage falls back to the column definitions", () => {
    expect(withStorage({}, () => headers(COLUMNS))).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(withStorage({}, () => headers(COLUMNS, "orders"))).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(withStorage("throws", () => headers(COLUMNS, "orders"))).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(withStorage("throws", () => readTableLayout("orders"))).toEqual({ orderedKeys: [], hiddenKeys: [], colWidths: {} });
  });

  test("another table's layout is never applied, and rendering settles in one pass", () => {
    const stored = { [tableLayoutStorageKey("other")]: JSON.stringify({ orderedKeys: ["c", "b", "a"], hiddenKeys: ["a"] }) };
    expect(withStorage(stored, () => headers(COLUMNS, "orders"))).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(withStorage(stored, () => headers(COLUMNS, "other"))).toEqual(["Charlie", "Bravo"]);
  });
});

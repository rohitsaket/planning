"use client";

import { useCallback, useState } from "react";

export function useServerPage(key: string): [number, (page: number) => void] {
  const [state, setState] = useState<{ key: string; page: number }>({ key, page: 1 });
  const page = state.key === key ? state.page : 1;
  const setPage = useCallback((next: number) => setState({ key, page: next }), [key]);
  return [page, setPage];
}

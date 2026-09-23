"use client";

import { useCallback, useState } from "react";

/**
 * Page cursor for a server-paginated table, tied to the request it belongs to.
 *
 * The cursor is stored together with the key of the filters and ordering it was chosen
 * under. When that key changes, the current page is page 1 again — derived, not written
 * back, so changing a filter cannot leave a request asking for page 7 of a result set
 * that no longer has one.
 */
export function useServerPage(key: string): [number, (page: number) => void] {
  const [state, setState] = useState<{ key: string; page: number }>({ key, page: 1 });
  const page = state.key === key ? state.page : 1;
  const setPage = useCallback((next: number) => setState({ key, page: next }), [key]);
  return [page, setPage];
}

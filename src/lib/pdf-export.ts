export function exportToPDF(title: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const originalTitle = document.title;
  document.title = title;
  window.print();
  setTimeout(() => {
    document.title = originalTitle;
  }, 500);
}

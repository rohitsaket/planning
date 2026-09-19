// PDF export via browser print — opens a print dialog with a clean layout.
// The accompanying @media print rules in globals.css hide chrome
// (sidebar / topbar / footer / filter bar) so only the main content + tables
// are emitted to the printed page / "Save as PDF" destination.

export function exportToPDF(title: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const originalTitle = document.title;
  // Set the document title so the OS print dialog suggests a meaningful file name.
  document.title = title;
  // Trigger the browser print dialog. This is a blocking call on most browsers
  // (the JS thread resumes only after the dialog is closed / saved).
  window.print();
  // Restore the original title shortly after the dialog is dismissed.
  setTimeout(() => {
    document.title = originalTitle;
  }, 500);
}

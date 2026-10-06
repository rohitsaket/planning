export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

export const PASSWORD_REQUIREMENTS = [
  `At least ${PASSWORD_MIN_LENGTH} characters`,
  "Different from your current password",
] as const;

export interface PasswordChangeInput {
  current: string;
  next: string;
  confirm: string;
}

export function passwordChangeProblems(input: PasswordChangeInput, currentLabel = "current password"): Partial<Record<keyof PasswordChangeInput, string>> {
  const problems: Partial<Record<keyof PasswordChangeInput, string>> = {};
  if (!input.current) problems.current = `Enter your ${currentLabel}.`;
  if (input.next.length < PASSWORD_MIN_LENGTH) problems.next = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  else if (input.next.length > PASSWORD_MAX_LENGTH) problems.next = `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  else if (input.next === input.current) problems.next = "Choose a password different from the current one.";
  if (!problems.next && input.confirm !== input.next) problems.confirm = "The passwords do not match.";
  return problems;
}

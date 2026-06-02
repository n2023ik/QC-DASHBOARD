export function parseApprovalTimestamp(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Try HH:MM format first (hours:minutes)
  const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    const hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
      const now = new Date();
      now.setHours(hours, minutes, 0, 0);
      return now.getTime();
    }
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

export function promptApprovalTimestamp(label: string) {
  const value = window.prompt(`${label}\nUse HH:MM (e.g., 14:30), ISO, YYYY-MM-DD HH:MM, or Unix ms`);
  if (value === null) return null;

  const parsed = parseApprovalTimestamp(value);
  if (!parsed) {
    window.alert("Approval timestamp is required and must be valid. Use HH:MM format (e.g., 14:30)");
    return null;
  }

  return parsed;
}
const DAY_FIRST_LOCALE = 'en-GB';

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(DAY_FIRST_LOCALE, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatMessageDate(iso: string): { short: string; full: string } {
  const date = new Date(iso);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const short = isToday
    ? date.toLocaleTimeString(DAY_FIRST_LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false })
    : date.toLocaleDateString(DAY_FIRST_LOCALE, { day: 'numeric', month: 'short' });

  return { short, full: formatDateTime(iso) };
}
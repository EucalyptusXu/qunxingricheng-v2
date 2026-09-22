/** 日期工具：统一使用本地时区的 YYYY-MM-DD 字符串 */

const pad = (n: number) => String(n).padStart(2, '0');

export function toDateString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromDateString(s: string): Date {
  return new Date(`${s}T00:00:00`);
}

export function addDays(s: string, days: number): string {
  const d = fromDateString(s);
  d.setDate(d.getDate() + days);
  return toDateString(d);
}

const WEEKDAYS_FULL = ['日', '一', '二', '三', '四', '五', '六'];

/** 「2026 年 9 月 21 日 · 周一」 */
export function formatDateFull(s: string): string {
  const d = fromDateString(s);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${WEEKDAYS_FULL[d.getDay()]}`;
}

export function monthLabel(year: number, monthIndex: number): string {
  return `${year} 年 ${monthIndex + 1} 月`;
}

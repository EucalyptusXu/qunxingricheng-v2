/** 日程相关类型定义 */

/** 提醒策略：提前分钟数；'none' 表示不提醒 */
export type ReminderOption = 'none' | '0' | '5' | '15';

export const REMINDER_LABELS: Record<ReminderOption, string> = {
  none: '不提醒',
  '0': '准时提醒',
  '5': '提前 5 分钟',
  '15': '提前 15 分钟',
};

export interface ScheduleEvent {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm */
  time: string;
  note?: string;
  reminder: ReminderOption;
  completed: boolean;
  /** 提醒是否已触发（防止重复提醒） */
  reminded: boolean;
  createdAt: number;
}

/** 事件的具体开始时间 */
export function eventDateTime(ev: Pick<ScheduleEvent, 'date' | 'time'>): Date {
  return new Date(`${ev.date}T${ev.time || '00:00'}:00`);
}

/** 提醒触发时间 = 开始时间 - 提前分钟数 */
export function reminderDateTime(ev: ScheduleEvent): Date | null {
  if (ev.reminder === 'none') return null;
  const t = eventDateTime(ev);
  t.setMinutes(t.getMinutes() - Number(ev.reminder));
  return t;
}

export function todayString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function nowTimeString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

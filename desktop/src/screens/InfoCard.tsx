import { Pill } from "../ui/kit";

export const leftText = (n: number) => (n < 0 ? `已逾期 ${-n} 天` : n === 0 ? "今天" : `${n} 天后`);

export function FilingDeadlinePill({ days }: { days: number }) {
  const text = leftText(days);
  if (days < 0) return <Pill text={text} kind="bad" icon="calendar.badge.clock" />;
  if (days <= 30) return <Pill text={text} kind="warn" icon="clock" title={`即将到期 · ${text}`} />;
  return <Pill text={text} />;
}

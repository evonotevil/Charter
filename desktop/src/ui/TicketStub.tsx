import { dueStubParts } from "./uistyle";

/** 柔和风格的到期票根：日 + 月，逾期红、30 天内琥珀。经典风格下隐藏。 */
export function TicketStub({ due, today }: { due: string; today: string }) {
  const p = dueStubParts(due, today);
  return (
    <span className={`tk-stub ${p.tone}`} aria-hidden>
      <b className="num">{p.day}</b><small>{p.month}</small>
    </span>
  );
}

import { dueStubParts } from "./uistyle";

/** 事项的日期块：日 + 月；逾期红、30 天内琥珀。 */
export function TicketStub({ due, today }: { due: string; today: string }) {
  const p = dueStubParts(due, today);
  return (
    <span className={`tk-stub ${p.tone}`} aria-hidden>
      <b className="num">{p.day}</b><small>{p.month}</small>
    </span>
  );
}

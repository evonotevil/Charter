// 5.5.5：修改持股比例时区分“股权变更”和“更正录入错误”；成组调整全部股东。设计稿：Figma「5.5.5」P3、P4、P5。
import { PercentField } from "./Editors";
import { useState } from "react";
import type { Company, Holding } from "../domain/models";
import type { Day } from "../domain/day";
import { percentLabel } from "../domain/engine";
import { useApp } from "../state/hooks";
import { Button, DateField, Modal, Note, RadioCard, SheetScaffold } from "../ui/kit";

/** 保存前询问是哪一种修改。 */
export function ShareChangeSheet({ company, changes, onClose, onDone }: { company: Company; changes: { h: Holding; percent: number }[]; onClose: () => void; onDone?: () => void }) {
  const { store } = useApp();
  const [mode, setMode] = useState<"change" | "correct">("change");
  const [on, setOn] = useState<Day | undefined>(store.today);
  const one = changes.length === 1 ? changes[0] : null;
  const subtitle = one ? `${store.nameOf(one.h.holder)} 持有 ${company.name} ${percentLabel(one.h.percent)} → ${percentLabel(one.percent)}` : `${company.name}：${changes.length} 位股东的比例有变化`;
  const save = () => { if (store.applyHoldingChanges(company.id, changes, mode, on)) { onDone?.(); onClose(); } };
  return <Modal onClose={onClose}>
    <SheetScaffold title="修改持股比例" subtitle={subtitle} width={600}
      trailing={<><Button onClick={onClose}>取消</Button><Button kind="primary" disabled={mode === "change" && !on} onClick={save}>保存</Button></>}>
      <div className="col gap12" role="radiogroup" aria-label="修改类型">
        <RadioCard selected={mode === "change"} onSelect={() => setMode("change")} title="股权变更"
          detail="实际发生了转让或增资。原记录截止到生效日前一天，从生效日起新建一段；历史结构保持原样。">
          <span className="row gap10"><span className="t-label muted">生效日</span><DateField value={on} onChange={setOn} minWidth={170} /></span>
        </RadioCard>
        <RadioCard selected={mode === "correct"} onSelect={() => setMode("correct")} title="更正录入错误"
          detail={one ? `原来就该是 ${percentLabel(one.percent)}，录错了。直接改原记录，所有历史日期都按新比例显示。` : "原来就该是这些比例，录错了。直接改原记录，所有历史日期都按新比例显示。"} />
      </div>
    </SheetScaffold>
  </Modal>;
}

/** 成组调整：一次改完所有股东，合计实时显示；超过 100% 标红但允许保存。 */
export function GroupAdjustSheet({ company, onClose }: { company: Company; onClose: () => void }) {
  const { store } = useApp();
  const hs = store.directShareholders(company.id);
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(hs.map((h) => [h.id, String(h.percent)])));
  const [confirm, setConfirm] = useState(false);
  const num = (id: string) => parseFloat(vals[id]);
  const total = Math.round(hs.reduce((a, h) => a + (num(h.id) || 0), 0) * 100) / 100;
  const over = total - 100;
  const scale = () => { if (!total) return; setVals(Object.fromEntries(hs.map((h) => [h.id, String(Math.round(((num(h.id) || 0) * 100 / total) * 100) / 100)]))); };
  const changes = hs.map((h) => ({ h, percent: num(h.id) })).filter((x) => Number.isFinite(x.percent) && x.percent !== x.h.percent);
  const bad = hs.some((h) => !(num(h.id) > 0 && num(h.id) <= 100));
  return <Modal onClose={onClose}>
    <SheetScaffold title={`调整 ${company.name} 的股东比例`} subtitle="一次改完所有股东，合计显示在下方。保存时同样会询问是变更还是更正。" width={640}
      leading={<Button kind="quiet" disabled={!total || Math.abs(over) < 0.005} onClick={scale}>按比例缩放到 100%</Button>}
      trailing={<><Button onClick={onClose}>取消</Button><Button kind="primary" disabled={!changes.length || bad} title={bad ? "每位股东的比例应在 0 到 100 之间" : undefined} onClick={() => setConfirm(true)}>保存</Button></>}>
      <div className="col gap12">
        <div className="col panel-soft">{hs.map((h, i) => <div key={h.id}>{i > 0 && <div className="hairline" style={{ marginLeft: 16 }} />}
          <div className="row gap12" style={{ padding: "10px 14px 10px 16px" }}>
            <span className="t-row grow ellipsis">{store.nameOf(h.holder)}</span>
            <PercentField ariaLabel={`${store.nameOf(h.holder)} 持股比例`} value={parseFloat(vals[h.id]) || 0} onChange={(n) => setVals({ ...vals, [h.id]: String(n) })} />
          </div></div>)}</div>
        {Math.abs(over) < 0.005 ? <Note tone="ok">合计 100%。</Note>
          : over > 0 ? <Note tone="bad">合计 {percentLabel(total)}，超出 {percentLabel(over)}。可以保存，但穿透比例和导出结果会标出不一致。</Note>
          : <Note tone="info">合计 {percentLabel(total)}，还有 {percentLabel(-over)} 未分配（可能有尚未录入的股东）。</Note>}
      </div>
    </SheetScaffold>
    {confirm && <ShareChangeSheet company={company} changes={changes} onClose={() => setConfirm(false)} onDone={onClose} />}
  </Modal>;
}

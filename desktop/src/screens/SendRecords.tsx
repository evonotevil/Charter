// 5.5：公司页「文件」标签下的材料包发送记录。设计稿：Figma「5.5 · 材料包水印」H。

import { useEffect, useState } from "react";
import type { Company } from "../domain/models";
import * as D from "../domain/day";
import { useApp } from "../state/hooks";
import { platform } from "../platform/platform";
import { Button, Card, Pill } from "../ui/kit";

export function SendRecords({ c }: { c: Company }) {
  const { store, router } = useApp();
  const rows = store.data.sends.filter((r) => r.companyID === c.id);
  const [exists, setExists] = useState<Record<string, boolean>>({});
  const [all, setAll] = useState(false);
  useEffect(() => {
    let live = true;
    void Promise.all(rows.map(async (r) => [r.id, (await platform().stat(r.path)).exists] as const)).then((x) => live && setExists(Object.fromEntries(x)));
    return () => { live = false; };
  }, [rows.map((r) => r.id).join()]);
  if (!rows.length) return null;
  const shown = all ? rows : rows.slice(0, 5);
  return <Card title="材料包发送记录" action={rows.length > 5 ? <Button kind="quiet" size="small" onClick={() => setAll(!all)}>{all ? "收起" : `全部 ${rows.length} 条`}</Button> : undefined} flush>
    {shown.map((r, i) => {
      const gone = exists[r.id] === false;
      const canRedo = store.data.library.packets.some((p) => p.id === r.packetID);
      return <div key={r.id}>
        {i > 0 && <div className="hairline" style={{ marginLeft: 20 }} />}
        <div className="row gap16" style={{ padding: "14px 20px" }}>
          <span className="t-meta muted num" style={{ width: 120, flex: "none" }}>{D.long(r.day)}</span>
          <div className="col grow" style={{ gap: 4, minWidth: 0 }}>
            <div className="row gap8"><span className="t-row ellipsis">{r.packetName}{r.recipient ? ` · 发给 ${r.recipient}` : ""}</span>
              {r.watermarkText ? <Pill text={r.flattened ? "已加水印 · 压平" : "已加水印"} kind="valid" /> : <Pill text="无水印" kind="neutral" />}
              {r.missing > 0 && <Pill text={`缺 ${r.missing} 项`} kind="warn" />}</div>
            {r.watermarkText && <span className="t-meta muted ellipsis selectable" data-tip={r.watermarkText}>水印：{r.watermarkText}</span>}
            <span className="t-meta muted num">{r.files} 份文件{r.watermarkText ? `，${r.watermarked} 份加水印` : ""}</span>
          </div>
          <Button size="small" disabled={gone} title={gone ? "在文件夹中找不到，可能已移动或删除" : undefined} onClick={() => void platform().reveal(r.path)}>打开</Button>
          <Button size="small" disabled={!canRedo} title={canRedo ? "用同样的用途、水印设置和接收方重新导出" : "这个用途已删除"}
            onClick={() => {
              if (r.watermark) store.saveLibrary((l) => { const t = l.packets.find((p) => p.id === r.packetID); if (t) t.watermark = structuredClone(r.watermark) as never; });
              router.open({ kind: "packetFor", companyID: c.id, purposeID: r.packetID, recipient: r.recipient });
            }}>按同样设置再导出</Button>
        </div>
      </div>;
    })}
  </Card>;
}

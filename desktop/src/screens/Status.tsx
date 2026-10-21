// 4.5 文件与档案状态：文字 + 图标 + 颜色（颜色只是加强，脱离颜色也能读懂）。定义见 规范/DESIGN.md §3.4。

import type { ArchiveState, Document, DocumentType } from "../domain/models";
import type { Freshness } from "../domain/engine";
import { Icon } from "../ui/Icon";

export type StatusKey = "held" | "expiring" | "expired" | "noDate" | "needsUpdate" | "missing" | "unverifiedMark" | "notApplicable" | "external" | "restricted" | "superseded";

export interface StatusView { key: StatusKey; text: string; icon: string; cls: string; hint: string }

export function statusOfArchive(s: ArchiveState): StatusView {
  switch (s.kind) {
    case "valid": return { key: "held", text: "已归档", icon: "checkmark.circle", cls: "held", hint: "有现行文件，在有效期内或长期有效" };
    case "expiring": return { key: "expiring", text: `${s.days} 天后到期`, icon: "hourglass", cls: "warn", hint: "30 天内到期" };
    case "expired": return { key: "expired", text: `已过期 ${s.days} 天`, icon: "exclamationmark.triangle", cls: "bad", hint: "过了到期日，需要取得新版" };
    case "noDate": return { key: "noDate", text: "缺日期", icon: "questionmark.circle", cls: "warn-o", hint: "有效期取决于日期，但签发或到期日没填" };
    case "needsUpdate": return { key: "needsUpdate", text: "需更新", icon: "arrow.triangle.2.circlepath", cls: "warn-o", hint: "公司信息变了，文件内容可能已过时" };
    case "missing": return { key: "missing", text: "待取得", icon: "circle.dashed", cls: "miss", hint: "还没有这份材料" };
    case "marked":
      switch (s.mark) {
        case "notObtained": return { key: "missing", text: "待取得", icon: "circle.dashed", cls: "miss", hint: "标记为未取得" };
        case "unverified": return { key: "unverifiedMark", text: "待核对", icon: "questionmark.circle", cls: "miss", hint: "还不确定是否存在或是否需要" };
        case "notApplicable": return { key: "notApplicable", text: "不适用", icon: "minus.circle", cls: "quiet", hint: "这家公司不需要；不计入档案 x/y" };
        case "external": return { key: "external", text: "外部保管", icon: "lock.circle", cls: "quiet", hint: "材料在中介或其他机构，本地没有副本；计入已有" };
        case "restricted": return { key: "restricted", text: "权限受限", icon: "lock.circle", cls: "quiet", hint: "材料存在但没有权限取得；计入已有" };
      }
  }
}

export function statusOfFreshness(f: Freshness): StatusView {
  switch (f.kind) {
    case "valid": return statusOfArchive({ kind: "valid" });
    case "expiring": return statusOfArchive({ kind: "expiring", days: f.days });
    case "expired": return statusOfArchive({ kind: "expired", days: f.days });
    case "needsUpdate": return statusOfArchive({ kind: "needsUpdate" });
    case "unknown": return statusOfArchive({ kind: "noDate" });
    case "superseded": return { key: "superseded", text: "旧版", icon: "clock.arrow.circlepath", cls: "quiet", hint: "已被新版本替代" };
  }
}

export function StatusTag({ s }: { s: StatusView }) {
  return <span className={`st ${s.cls}`} title={s.hint}><Icon name={s.icon} size={11} strokeWidth={2.4} />{s.text}</span>;
}

/** 附加标签：已签署 / 待签署（类型要求签署时）、已核实（与原件核对过）。 */
export function ExtraTags({ d, t }: { d: Document; t?: DocumentType }) {
  return (
    <>
      {t?.requiresSignature && (d.signedOn
        ? <span className="st extra" title={`签署于 ${d.signedOn}`}><Icon name="pencil" size={10} />已签署</span>
        : <span className="st warn-o" title="这类文件需要签署，还没有记录签署日期"><Icon name="pencil" size={10} />待签署</span>)}
      {d.verifiedOn && <span className="st extra" title={`${d.verifiedOn} 与原件核对过`}><Icon name="checkmark.seal" size={10} />已核实</span>}
    </>
  );
}

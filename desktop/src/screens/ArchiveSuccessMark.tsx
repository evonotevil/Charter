import { Sparkle } from "lucide-react";
import { Icon } from "../ui/Icon";
import "./archiveSuccessMark.css";

/** Only the badge moves. The result text and actions are available immediately. */
export function ArchiveSuccessMark() {
  return <span className="archive-success-mark" data-archive-success-mark="" aria-hidden="true">
    <span data-part="paper"><Icon name="doc.text" size={22} /></span>
    <span data-part="tray"><Icon name="tray" size={28} /></span>
    <span data-part="seal" />
    <span data-part="check"><Icon name="checkmark" size={24} /></span>
    <span data-part="spark-top"><Sparkle size={13} fill="currentColor" strokeWidth={0} /></span>
    <span data-part="spark-left"><Sparkle size={8} fill="currentColor" strokeWidth={0} /></span>
    <span data-part="spark-dot" />
  </span>;
}

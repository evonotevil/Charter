import { Icon } from "./Icon";

export function PreviewPager({ page, pages, onPageChange }: {
  page: number;
  pages: number;
  onPageChange: (page: number) => void;
}) {
  const first = page <= 1;
  const last = page >= pages;
  return <div className="preview-pager" role="group" aria-label="预览翻页">
    <button type="button" className="icon-btn sunken" disabled={!pages || first}
      aria-label="上一页" title={!pages ? "正在读取页数" : first ? "已经是第一页" : "上一页"} onClick={() => onPageChange(page - 1)}>
      <Icon name="chevron.left" size={16} />
    </button>
    <span className="t-meta num preview-page-number" aria-live="polite" aria-atomic="true">{pages ? `${page} / ${pages}` : "— / —"}</span>
    <button type="button" className="icon-btn sunken" disabled={!pages || last}
      aria-label="下一页" title={!pages ? "正在读取页数" : last ? "已经是最后一页" : "下一页"} onClick={() => onPageChange(page + 1)}>
      <Icon name="chevron.right" size={16} />
    </button>
  </div>;
}

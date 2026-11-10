export type DemoView = "structure" | "company" | "deadlines" | "documents" | "people";

const titles: Record<DemoView, string> = {
  structure: "股权结构",
  company: "公司档案",
  deadlines: "申报到期",
  documents: "文件",
  people: "人员与任职",
};

export function WorkspaceDemo({ view }: { view: DemoView }) {
  const src = `./workspace.html?view=${view}`;
  return <div className="workspace-embed">
    <iframe src={src} title={`Charter 演示：${titles[view]}`} loading="lazy" sandbox="allow-scripts allow-same-origin" />
    <a className="workspace-open" href={src} target="_blank" rel="noopener">在新标签页打开演示</a>
  </div>;
}

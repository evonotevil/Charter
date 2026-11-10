export type DemoView = "structure" | "company" | "deadlines" | "documents" | "people" | "packet";

const titles: Record<DemoView, string> = {
  structure: "股权结构",
  company: "公司档案",
  deadlines: "申报到期",
  documents: "文件",
  people: "人员与任职",
  packet: "准备材料与加水印",
};

export function WorkspaceDemo({ view }: { view: DemoView }) {
  const src = `./workspace.html?view=${view}`;
  return <div className={view === "packet" ? "workspace-embed workspace-packet" : "workspace-embed"}>
    <iframe src={src} title={`Charter 演示：${titles[view]}`} loading="lazy" sandbox="allow-scripts allow-same-origin" />
    <a className="workspace-open" href={src} target="_blank" rel="noopener">在新标签页打开演示</a>
    <div className="workspace-mobile">
      <p>演示会在新标签页打开。横屏可以看到更多应用界面。</p>
      <a className="secondary" href={src} target="_blank" rel="noopener">打开{titles[view]}演示</a>
    </div>
  </div>;
}

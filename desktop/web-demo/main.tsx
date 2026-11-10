import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/nunito/latin-800.css";
import "../src/ui/styles.css";
import "./story.css";
import { Button, Pill } from "../src/ui/kit";
import { LogoMark } from "../src/ui/Logo";
import { WorkspaceDemo } from "./WorkspaceDemo";


const scenes = [
  { id: "structure", title: "这家公司属于谁？", description: "从集团的股权图看子公司、持股比例和控制关系，再顺着结构找到你要查的公司。", label: "看集团关系", view: "structure", next: "company", action: "接着看公司档案" },
  { id: "company", title: "这家公司的资料在哪？", description: "进入公司档案，查登记信息、股东和任职人员，顺手找到关联的文件。", label: "找公司档案", view: "company", next: "deadlines", action: "接着看待办事项" },
  { id: "deadlines", title: "接下来有什么要办？", description: "切到申报日历，看哪些事项快到期、涉及哪家公司，再安排处理。", label: "查到期事项", view: "deadlines", next: "gallery", action: "探索全部功能" },
] as const;
const views = [
  { label: "看股权", view: "structure", caption: "从集团一路看到子公司和持股比例。" },
  { label: "查到期", view: "deadlines", caption: "查看申报事项和证件的到期日，安排下一步。" },
  { label: "找档案", view: "company", caption: "按公司找回基本资料、登记信息和历史记录。" },
  { label: "管文件", view: "documents", caption: "按公司和文件类型归档，需要时可打包导出并为副本加水印。" },
  { label: "查任职", view: "people", caption: "从人员档案查看关联公司与任职情况。" },
] as const;
const release = "https://github.com/evonotevil/Charter/releases";
const packages = [
  ["Mac", [["Apple 芯片", "Mac-arm64.dmg"], ["Intel 芯片", "Mac-x64.dmg"]]],
  ["Windows", [["安装版", "Windows-Setup.exe"], ["免安装版", "Windows-x64.zip"]]],
] as const;

function Gallery() {
  const [index, setIndex] = useState(0);
  const view = views[index];
  return <section className="gallery" id="gallery" tabIndex={-1}>
    <header className="section-intro">
      <h2>从你手头的事开始。</h2>
      <p>同一个工作区，五种查看方式。</p>
    </header>
    <div className="gallery-controls" role="group" aria-label="产品视图">
      {views.map((item, i) => <button type="button" key={item.label} aria-pressed={i === index} onClick={() => setIndex(i)}>{item.label}</button>)}
    </div>
    <figure className="product-frame">
      <WorkspaceDemo key={view.view} view={view.view} />
      <figcaption aria-live="polite">{view.caption}</figcaption>
    </figure>
  </section>;
}

function Downloads() {
  return <section className="downloads" id="download">
    <header className="section-intro">
      <h2>公司资料，留在自己的文件夹。</h2>
      <p>无需账户。Charter 将数据保存在你选定的文件夹里。</p>
    </header>
    <div className="platforms">
      {packages.map(([platform, variants]) => <div key={platform}>
        <h3>{platform}</h3>
        {variants.map(([label, file]) => <a key={file} href={`${release}/download/v5.5.0/Charter-5.5.0-${file}`}><span>{label}</span><span>下载</span></a>)}
      </div>)}
    </div>
    <div className="install-guide">
      <h3>首次打开 Charter</h3>
      <p>首次打开时，系统可能提示无法验证开发者。请先确认安装包来自 <a href={`${release}/tag/v5.5.0`}>官方 GitHub 发布页</a>，并核对 <a href={`${release}/download/v5.5.0/SHA256SUMS.txt`}>SHA-256 校验值</a>。</p>
      <div className="install-platforms">
        <section>
          <h4>Mac</h4>
          <ol>
            <li>打开 DMG，把 Charter 拖到「应用程序」，然后从「应用程序」打开一次。</li>
            <li>如果提示无法验证开发者，打开「系统设置 → 隐私与安全性」，找到 Charter 的提示，点「仍要打开」并确认。<a href="https://support.apple.com/zh-cn/102445">Apple 官方说明</a></li>
            <li>如果已确认来源和校验值，也可以打开「终端」，粘贴下面的命令并按回车，再从「应用程序」打开 Charter：</li>
          </ol>
          <pre><code>xattr -cr /Applications/Charter.app</code></pre>
          <p>这会递归清除这个应用包的扩展属性（包括下载隔离标记）。成功时通常没有输出。若提示找不到文件，请先确认 Charter 已放进「应用程序」且名称未改。</p>
        </section>
        <section>
          <h4>Windows</h4>
          <ol>
            <li>安装版：打开下载的 <code>Setup.exe</code>。免安装版：先解压 ZIP，再打开解压目录里的 <code>Charter.exe</code>。</li>
            <li>如果 Microsoft Defender SmartScreen 显示「Windows 已保护你的电脑」，确认来源和校验值后，点「更多信息 → 仍要运行」（如果该选项可用）。</li>
            <li>如果提示检测到威胁，或设备策略不允许继续，请停止安装；公司设备可联系 IT。<a href="https://support.microsoft.com/en-us/windows/security/windows-security/app-browser-control-in-the-windows-security-app">Microsoft 官方说明</a></li>
          </ol>
        </section>
      </div>
    </div>
  </section>;
}

function App() {
  const [active, setActive] = useState(0);
  const [stacked, setStacked] = useState(() => matchMedia("(max-width: 960px), (max-height: 720px), (prefers-reduced-motion: reduce)").matches);
  const steps = useRef<(HTMLElement | null)[]>([]);
  const layers = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const entry = steps.current.find((step) => step && `#${step.id}` === location.hash);
    entry?.scrollIntoView();
  }, []);

  useEffect(() => {
    const query = matchMedia("(max-width: 960px), (max-height: 720px), (prefers-reduced-motion: reduce)");
    const update = () => setStacked(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (stacked) return;
    let frame = 0;
    const update = () => {
      const height = window.innerHeight;
      const bounds = steps.current.map((step) => step?.getBoundingClientRect().top ?? Infinity);
      // Each incoming chapter gets a band of scroll distance instead of a switch point.
      const position = bounds.slice(1).reduce((sum, top) => {
        const fraction = Math.max(0, Math.min(1, (height * 0.78 - top) / (height * 0.52)));
        return sum + fraction * fraction * (3 - 2 * fraction);
      }, 0);
      layers.current.forEach((layer, i) => {
        if (!layer) return;
        const distance = i - position;
        layer.style.setProperty("--scene-opacity", String(Math.max(0, 1 - Math.abs(distance))));
        layer.style.setProperty("--scene-offset", `${Math.max(-1, Math.min(1, distance)) * 14}px`);
      });
      setActive(Math.round(position));
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [stacked]);

  function scene(i: number) {
    const item = scenes[i];
    return <>
      <header className="panel-head"><h3>{item.label}</h3><Pill text="演示数据" /></header>
      <WorkspaceDemo view={item.view} />
      <div className="panel-foot">
        <Button kind="primary" onClick={() => {
          const target = document.getElementById(item.next);
          target?.focus({ preventScroll: true });
          target?.scrollIntoView();
        }}>{item.action}</Button>
      </div>
    </>;
  }

  return <div className="shell">
    <header className="site-nav"><a href="#top" className="brand"><LogoMark size={29} />Charter</a><a href="#workflow">体验工作流</a><a href="#gallery">功能展厅</a><a href="#download">下载 Charter</a></header>
    <main id="top">
      <section className="intro">
        <Pill text="本地优先的公司治理工作区" />
        <h1>看清集团关系，<br />管好每一家公司。</h1>
        <p>Charter 把集团股权、公司档案、申报到期、文件和任职人员串在一起。</p>
        <div className="hero-actions">
          <a className="start" href="#workflow">体验工作流 <span aria-hidden="true">↓</span></a>
          <a className="secondary" href="#download">下载 Charter</a>
        </div>
        <figure className="product-frame hero-frame">
          <WorkspaceDemo view="structure" />
          <figcaption>试一试：点击股权节点，或用左侧导航探索其他页面。数据仅供演示。</figcaption>
        </figure>
      </section>
      <section className="section-intro packet-intro" id="workflow">
        <h2>从集团全图，看到下一件待办。</h2>
        <p>沿着三个常见问题，看看集团关系、公司档案和日常事项如何放在一起。</p>
        <a href="#gallery">跳到功能展厅</a>
      </section>
      <section className="story" aria-label="Charter 工作流演示">
        <div className="steps">
          {scenes.map((item, i) => <article className="step" id={item.id} tabIndex={-1} ref={(element) => { steps.current[i] = element; }} key={item.id}>
            <div className="step-copy">
              <span className="step-label">第 {i + 1} 步 / {item.label}</span>
              <h2>{item.title}</h2>
              <p>{item.description}</p>
            </div>
            {stacked && <div className="panel" data-scene={item.id}>{scene(i)}</div>}
          </article>)}
        </div>
        {!stacked && <div className="stage">
          <nav className="scene-nav" aria-label="跳到演示步骤">{scenes.map((item, i) =>
            <a key={item.id} href={`#${item.id}`} aria-current={active === i ? "step" : undefined}>{item.label}</a>
          )}</nav>
          <div className="layers">
            {scenes.map((item, i) => <div key={item.id} className="panel layer" data-scene={item.id} data-active={active === i}
              aria-hidden={active !== i} ref={(element) => {
                layers.current[i] = element;
                if (element) element.inert = active !== i;
              }}>{scene(i)}</div>)}
          </div>
          <p className="stage-caption">Charter 真实应用界面 / 虚构演示数据</p>
        </div>}
      </section>
      <Gallery />
      <Downloads />
    </main>
    <footer><span>Charter 5.5.0</span><a href="https://github.com/evonotevil/Charter">GitHub 源码</a></footer>
  </div>;
}

createRoot(document.getElementById("demo")!).render(<App />);

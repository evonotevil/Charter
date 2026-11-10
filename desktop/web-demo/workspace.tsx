import { createRoot } from "react-dom/client";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-800.css";
import "@fontsource/nunito/latin-800.css";
import "@fontsource/nunito/latin-900.css";
import "../src/ui/styles.css";
import templates from "../src/assets/charter-templates.json?raw";
import { MemoryPlatform } from "../src/platform/memory";
import { setPlatform } from "../src/platform/platform";
import { Shell } from "../src/screens/Shell";
import { Ctx } from "../src/state/hooks";
import { Router } from "../src/state/router";
import { installSampleData } from "../src/state/sample";
import { Store } from "../src/state/store";
import { SyncMonitor } from "../src/state/sync";
import { installTooltips } from "../src/ui/tooltip";

async function boot() {
  const memory = new MemoryPlatform(templates);
  setPlatform(memory);
  const store = new Store(await memory.defaultRoot());
  await store.load();
  await installSampleData(store);

  const router = new Router();
  const view = new URLSearchParams(location.search).get("view");
  switch (view) {
    case "company": {
      const company = store.data.companies.find((item) => item.registrationNumber === "2891043") ?? store.data.companies[0];
      if (company) router.openCompany(company.id);
      break;
    }
    case "deadlines": router.go("due"); break;
    case "documents": router.go("files"); break;
    case "people": router.go("people"); break;
    default: router.go("structure");
  }

  const sync = new SyncMonitor();
  sync.start(store.folder.root);
  installTooltips();
  const root = document.getElementById("root")!;
  root.removeAttribute("aria-busy");
  createRoot(root).render(<Ctx.Provider value={{ store, router, sync }}><Shell /></Ctx.Provider>);
}

void boot().catch((error: unknown) => {
  console.error(error);
  const root = document.getElementById("root");
  root?.removeAttribute("aria-busy");
  if (root) root.textContent = "演示工作区未能打开，请刷新后重试。";
});

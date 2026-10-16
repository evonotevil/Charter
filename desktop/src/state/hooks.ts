// React 接入：订阅 Store 与 Router 的变化。

import { createContext, useContext, useSyncExternalStore } from "react";
import type { Store } from "./store";
import type { Router } from "./router";
import type { SyncMonitor } from "./sync";

export interface AppContext { store: Store; router: Router; sync: SyncMonitor }
export const Ctx = createContext<AppContext | null>(null);

export function useApp(): AppContext {
  const c = useContext(Ctx);
  if (!c) throw new Error("AppContext missing");
  useSyncExternalStore(c.store.subscribe, c.store.getVersion);
  useSyncExternalStore(c.router.subscribe, c.router.getVersion);
  useSyncExternalStore(c.sync.subscribe, c.sync.getVersion);
  return c;
}

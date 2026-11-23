import type { NodeKind, NodeRef } from "../domain/models";

export type BroadFilesScope = "all" | NodeKind;
export type FilesScope = BroadFilesScope | `${NodeKind}:${string}`;

export function ownerKey(owner: NodeRef): FilesScope {
  return `${owner.kind}:${owner.id}`;
}

export function isBroadScope(scope: FilesScope): scope is BroadFilesScope {
  return scope === "all" || scope === "company" || scope === "person";
}

export interface FilesBrowseView {
  scope: FilesScope;
  broadScope: BroadFilesScope;
  query: string;
  expanded: ReadonlySet<string>;
  collapsedMatches: ReadonlySet<string>;
  collapsedSearch: ReadonlySet<string>;
}

export function initialFilesBrowseView(): FilesBrowseView {
  return { scope: "all", broadScope: "all", query: "", expanded: new Set(), collapsedMatches: new Set(), collapsedSearch: new Set() };
}

export function chooseFilesScope(view: FilesBrowseView, scope: FilesScope): FilesBrowseView {
  return { ...view, scope, broadScope: isBroadScope(scope) ? scope : view.broadScope, collapsedMatches: new Set(), collapsedSearch: new Set() };
}

type GroupStateField = "expanded" | "collapsedMatches" | "collapsedSearch";

export function setFilesGroupsOpen(view: FilesBrowseView, keys: readonly string[], field: GroupStateField, open: boolean): FilesBrowseView {
  const next = new Set(view[field]);
  const include = field === "expanded" ? open : !open;
  for (const key of keys) {
    if (include) next.add(key);
    else next.delete(key);
  }
  return { ...view, [field]: next };
}

// Session-only. Going to an owner's profile and back keeps the Files workspace.
export class FilesBrowseSession {
  view = initialFilesBrowseView();
  scrollTop = 0;
  private positions = new Map<string, number>();
  remember(key: string, offset: number) {
    this.positions.delete(key);
    this.positions.set(key, offset);
    // Search results can also be narrowed by owner. Bound the per-window history.
    if (this.positions.size > 64) this.positions.delete(this.positions.keys().next().value!);
  }
  position(key: string) { return this.positions.get(key) ?? 0; }
}

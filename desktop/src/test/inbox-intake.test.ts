import { readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";
import { expect, it, vi } from "vitest";
import { MemoryPlatform } from "../platform/memory";
import { setPlatform } from "../platform/platform";
import { writeXLSX } from "../services/files";
import { addToInbox, applyInboxChoiceToImport, collectInboxFiles, inboxItemLookup, inboxLinksForImport, processInbox, resolveTarget, updateInbox } from "../state/lifecycle";
import { Router } from "../state/router";
import { installSampleData } from "../state/sample";
import { Store, type ImportItem } from "../state/store";
import type { InboxImportProgress } from "../domain/inboxImport";
import type { InboxItem } from "../domain/models";
import { inboxProgressText } from "../screens/InboxImportProgress";

const templates = readFileSync(new URL("../assets/charter-templates.json", import.meta.url), "utf8");

it.each(["company", "person"] as const)("待整理的 %s 归属在没有类型时即可显示，补齐类型后才可归档", async (kind) => {
  setPlatform(new MemoryPlatform(templates));
  const store = new Store("/Charter");
  await store.load();
  const item: InboxItem = {
    id: "pending", fileName: "材料.pdf", path: "inbox/材料.pdf", sourcePath: "/drop/材料.pdf",
    addedOn: "2026-11-23", sha256: "abc", size: 20, confidence: 0, reasons: [],
    category: kind, companyID: "detected-company", personIDs: ["detected-person"],
  };
  const type = store.data.library.documentTypes.find((t) => t.owner === kind)!;
  const manual = { kind, id: "chosen-owner" };
  expect(resolveTarget(store, item)).toEqual({ category: kind, owner: { kind, id: `detected-${kind}` }, problem: "选文件类型" });
  expect(resolveTarget(store, { ...item, chosen: { owner: manual } })).toEqual({ category: kind, owner: manual, problem: "选文件类型" });
  expect(resolveTarget(store, { ...item, chosen: { owner: manual, typeID: type.id } })).toMatchObject({
    owner: manual, req: { owner: manual, typeID: type.id },
  });
});

it("导入向导保留待整理中手选的分类、归属和类型", async () => {
  setPlatform(new MemoryPlatform(templates));
  const store = new Store("/Charter");
  await store.load();
  const personType = store.data.library.documentTypes.find((type) => type.owner === "person")!;
  const companyType = store.data.library.documentTypes.find((type) => type.owner === "company")!;
  const recognized: ImportItem = {
    id: "import", path: "/Charter/inbox/材料.pdf", recognized: true, include: true, evidence: [],
    owner: { kind: "company", id: "recognized-company" }, typeID: companyType.id, newCompanyKey: "guess:wrong",
    confidence: 0.9, needsReview: false, typeUncertain: false, ownerUncertain: false, confirmed: false,
  };
  const source = (chosen: InboxItem["chosen"]): InboxItem => ({
    id: "pending", fileName: "材料.pdf", path: "inbox/材料.pdf", sourcePath: "/drop/材料.pdf",
    addedOn: "2026-11-23", sha256: "abc", size: 20, confidence: 0, reasons: [], chosen,
  });
  const person = { kind: "person", id: "chosen-person" } as const;

  expect(applyInboxChoiceToImport(store, recognized, source({ category: "person", owner: person, typeID: personType.id }))).toMatchObject({
    owner: person, typeID: personType.id, newCompanyKey: undefined, confirmed: true, ownerUncertain: false, typeUncertain: false,
  });
  expect(applyInboxChoiceToImport(store, recognized, source({ category: "evidence", owner: person }))).toMatchObject({
    owner: person, typeID: "person.appointment", newCompanyKey: undefined, confirmed: true,
  });
  expect(applyInboxChoiceToImport(store, recognized, source({ category: "evidence", owner: person, typeID: "person.identity" }))).toMatchObject({
    owner: person, typeID: "person.appointment", newCompanyKey: undefined, confirmed: true,
  });
  expect(applyInboxChoiceToImport(store, recognized, source({ category: "person" }))).toMatchObject({
    owner: undefined, typeID: undefined, newCompanyKey: undefined, confirmed: false,
  });
  expect(applyInboxChoiceToImport(store, { ...recognized, confidence: 0.2, needsReview: true, ownerUncertain: true, typeUncertain: true }, source({
    category: "company", owner: { kind: "company", id: "chosen-company" },
  }))).toMatchObject({
    owner: { kind: "company", id: "chosen-company" }, typeID: companyType.id, confirmed: false, ownerUncertain: false, typeUncertain: true,
  });
  expect(applyInboxChoiceToImport(store, recognized, source({ category: "irrelevant" }))).toMatchObject({ include: false });
  expect(applyInboxChoiceToImport(store, recognized, source({
    category: "company", owner: person, typeID: personType.id,
  }))).toMatchObject({
    owner: { kind: "company", id: "recognized-company" }, typeID: companyType.id, confirmed: false,
  });

  const staleAfterBatchChange = source({ category: "person", owner: { kind: "company", id: "old-company" }, typeID: companyType.id });
  staleAfterBatchChange.personIDs = ["detected-person"];
  staleAfterBatchChange.typeID = personType.id;
  expect(resolveTarget(store, staleAfterBatchChange)).toMatchObject({
    category: "person", owner: { kind: "person", id: "detected-person" }, req: { typeID: personType.id },
  });
});

it("导入向导未改变任职证据时保留任职关联，改变类型后不沿用", async () => {
  setPlatform(new MemoryPlatform(templates));
  const store = new Store("/Charter");
  await store.load();
  await installSampleData(store);
  const appointment = store.data.appointments[0];
  const owner = { kind: "person", id: appointment.personID } as const;
  const source: InboxItem = {
    id: "evidence", fileName: "任职证明.pdf", path: "inbox/任职证明.pdf", sourcePath: "/drop/任职证明.pdf",
    addedOn: "2026-11-23", sha256: "abc", size: 20, confidence: 0, reasons: [],
    chosen: { category: "evidence", owner, appointmentIDs: [appointment.id] },
  };

  expect(inboxLinksForImport(store, source, "person.appointment", owner)).toEqual(expect.arrayContaining([
    { target: "appointment", id: appointment.id, kind: "appointment" },
    { target: "company", id: appointment.companyID, kind: "appointment" },
  ]));
  expect(inboxLinksForImport(store, source, "person.identity", owner)).toBeUndefined();
});

it("按分类处理所选同时归档可处理项、把无关项移到废纸篓并保留未完成项", async () => {
  const memory = new MemoryPlatform(templates);
  setPlatform(memory);
  const store = new Store("/Charter");
  await store.load();
  await installSampleData(store);
  for (const [name, body] of [["可归档.pdf", "archive me"], ["无关.pdf", "trash me"], ["未完成.pdf", "leave me"]] as const) {
    await memory.writeText(`/drop/${name}`, body);
  }
  expect(await addToInbox(store, ["/drop/可归档.pdf", "/drop/无关.pdf", "/drop/未完成.pdf"])).toMatchObject({ added: 3 });
  const company = store.data.companies[0];
  const typeID = store.data.library.documentTypes.find((type) => type.owner === "company")!.id;
  const byName = (name: string) => store.data.inbox.find((item) => item.fileName === name)!;
  updateInbox(store, [byName("可归档.pdf").id], { category: "company", owner: { kind: "company", id: company.id }, typeID });
  updateInbox(store, [byName("无关.pdf").id], { category: "irrelevant" });
  updateInbox(store, [byName("未完成.pdf").id], { category: "company", owner: { kind: "company", id: company.id }, typeID: undefined });

  const selected = store.data.inbox.map((item) => item.id);
  const ready = store.data.inbox.filter((item) => resolveTarget(store, item).req || resolveTarget(store, item).category === "irrelevant");
  expect(ready.filter((item) => resolveTarget(store, item).req)).toHaveLength(1);
  expect(ready.filter((item) => resolveTarget(store, item).category === "irrelevant")).toHaveLength(1);
  const result = await processInbox(store, selected);
  expect(result).toMatchObject({ archived: [expect.objectContaining({ typeID, owner: { kind: "company", id: company.id } })], trashed: 1, skipped: 1 });
  expect(store.data.inbox.map((item) => item.fileName)).toEqual(["未完成.pdf"]);
  expect(store.data.trash.at(-1)).toMatchObject({ kind: "inbox", inbox: { fileName: "无关.pdf" } });
  for (const name of ["可归档.pdf", "无关.pdf", "未完成.pdf"]) expect((await memory.stat(`/drop/${name}`)).exists).toBe(true);
});

it("按分类处理所选在全为无关时全部移到废纸篓且不创建档案", async () => {
  const memory = new MemoryPlatform(templates);
  setPlatform(memory);
  const store = new Store("/Charter");
  await store.load();
  await memory.writeText("/drop/广告.pdf", "advertisement");
  await memory.writeText("/drop/重复.pdf", "duplicate notice");
  expect(await addToInbox(store, ["/drop/广告.pdf", "/drop/重复.pdf"])).toMatchObject({ added: 2 });
  updateInbox(store, store.data.inbox.map((item) => item.id), { category: "irrelevant" });
  const beforeDocuments = store.data.documents.length;
  const result = await processInbox(store, store.data.inbox.map((item) => item.id));
  expect(result).toMatchObject({ archived: [], trashed: 2, skipped: 0 });
  expect(store.data.documents).toHaveLength(beforeDocuments);
  expect(store.data.inbox).toEqual([]);
  expect(store.data.trash.map((entry) => entry.inbox?.fileName)).toEqual(expect.arrayContaining(["广告.pdf", "重复.pdf"]));
  expect((await memory.stat("/drop/广告.pdf")).exists).toBe(true);
  expect((await memory.stat("/drop/重复.pdf")).exists).toBe(true);
});

async function wordFile(text: string) {
  const zip = new JSZip();
  zip.file("word/document.xml", `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: "uint8array" });
}

it("分别报告不可用的文件，并按内容比对连续接收的同名 Word 文件", async () => {
  const platform = new MemoryPlatform(templates);
  setPlatform(platform);
  const store = new Store("/Charter");
  await store.load();
  const original = await wordFile("First record");
  await platform.writeBytes("/one/材料.docx", original);
  await platform.writeBytes("/two/材料.docx", await wordFile("Second record"));
  await platform.writeText("/one/其他.txt", "其他格式");

  const first = await addToInbox(store, ["/one/材料.docx", "/missing.docx", "/one/其他.txt"]);
  expect(first).toMatchObject({ added: 1, duplicates: 0, failed: 1, unsupported: 1 });
  const second = await addToInbox(store, ["/two/材料.docx", "/one/材料.docx"]);
  expect(second).toMatchObject({ added: 2, duplicates: 1, failed: 0, unsupported: 0 });

  const reopened = new Store("/Charter");
  await reopened.load();
  const [firstFile, different, repeat] = reopened.data.inbox;
  expect(reopened.data.inbox).toHaveLength(3);
  expect(different.duplicateOf).toBeUndefined();
  expect(repeat.duplicateOf).toBe(`inbox:${firstFile.id}`);
  expect(await platform.readBytes(reopened.folder.abs(firstFile.path))).toEqual(original);
});

it("识别进度使用展开后的真实文件名、序号和已完成数量", async () => {
  const memory = new MemoryPlatform(templates);
  setPlatform(memory);
  const store = new Store("/Charter");
  await store.load();
  await memory.writeText("/drop/Board-Consent-A.pdf", "first");
  await memory.writeBytes("/drop/董事名册.xlsx", await writeXLSX("名册", [["董事名册"]]));
  const progress: InboxImportProgress[] = [];
  await addToInbox(store, ["/drop"], (next) => progress.push(next));

  const recognizing = progress.filter((item) => item.phase === "recognizing");
  expect(recognizing.map((item) => ({ files: item.files, index: item.currentIndex, completed: item.completed }))).toEqual([
    { files: ["Board-Consent-A.pdf", "董事名册.xlsx"], index: 0, completed: 0 },
    { files: ["Board-Consent-A.pdf", "董事名册.xlsx"], index: 1, completed: 1 },
  ]);
  expect(progress.at(-1)).toMatchObject({ phase: "saving", total: 2, completed: 2 });
  expect(inboxProgressText(recognizing[0])).toEqual({
    title: "正在识别文件", fileName: "Board-Consent-A.pdf", count: "1 / 2", completed: "已完成 0 份",
  });
});

it("XLSX 可由选择器或文件夹加入，按单元格识别后原样归档", async () => {
  const platform = new MemoryPlatform(templates);
  setPlatform(platform);
  const store = new Store("/Charter");
  await store.load();
  await installSampleData(store);
  const company = store.data.companies[0];
  const source = "/incoming/清单.XLSX";
  const workbook = await writeXLSX("明细", [["董事名册"], [company.name]]);
  await platform.writeBytes(source, workbook);
  await platform.writeText("/incoming/旧清单.xls", "旧格式");

  const pick = vi.spyOn(platform, "pickFiles").mockResolvedValue([source]);
  const router = new Router();
  await router.chooseFiles(null);
  const extensions = pick.mock.calls[0][0]?.extensions;
  expect(extensions).toContain("xlsx");
  expect(extensions).not.toContain("xls");
  expect(router.beginInboxImport("/Charter")).toMatchObject({ paths: [source], dataRoot: "/Charter" });
  expect(router.filesPane).toBe("inbox");

  vi.stubGlobal("DOMParser", DOMParser);
  try {
    const result = await addToInbox(store, ["/incoming"]);
    expect(result).toMatchObject({ added: 1, unsupported: 1, failed: 0 });
    const item = store.data.inbox.find(i => i.fileName === "清单.XLSX")!;
    expect(item.textExcerpt).toContain("董事名册");
    expect(item.reasons.some(reason => reason.includes("工作表中含"))).toBe(true);
    expect(item.companyID).toBe(company.id);
    const { archived } = await processInbox(store, [item.id]);
    expect(archived).toHaveLength(1);
    expect(archived[0].originalFileName).toBe("清单.XLSX");
    expect(archived[0].filePath.toLowerCase()).toMatch(/\.xlsx$/);
    expect(await platform.readBytes(store.fileURL(archived[0]))).toEqual(workbook);
    expect(await platform.readBytes(source)).toEqual(workbook);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("保留每个未加入路径的名称、稳定原因，并只把真正空的顶层文件夹标为空", async () => {
  const memory = new MemoryPlatform(templates);
  setPlatform(memory);
  await memory.writeText("/mixed/可用.pdf", "pdf");
  await memory.writeText("/mixed/旧预算.xls", "xls");
  await memory.mkdirs("/empty");
  await memory.mkdirs("/locked");
  const originalStat = memory.stat.bind(memory);
  vi.spyOn(memory, "stat").mockImplementation(async (path) => {
    if (path === "/private/读不到.pdf") throw new Error("没有权限");
    return originalStat(path);
  });
  const originalListDir = memory.listDir.bind(memory);
  vi.spyOn(memory, "listDir").mockImplementation(async (path) => {
    if (path === "/locked") throw new Error("无法列出目录");
    return originalListDir(path);
  });

  const result = await collectInboxFiles(["/mixed", "/empty", "/missing.pdf", "/private/读不到.pdf", "/locked"]);
  expect(result.files).toEqual(["/mixed/可用.pdf"]);
  expect(result.issues).toEqual([
    { path: "/mixed/旧预算.xls", name: "旧预算.xls", reason: "unsupported" },
    { path: "/empty", name: "empty", reason: "empty" },
    { path: "/missing.pdf", name: "missing.pdf", reason: "missing" },
    { path: "/private/读不到.pdf", name: "读不到.pdf", reason: "unreadable", detail: "没有权限" },
    { path: "/locked", name: "locked", reason: "unreadable", detail: "无法列出目录" },
  ]);

  const store = new Store("/Charter");
  await store.load();
  const allFailed = await addToInbox(store, ["/empty", "/missing.pdf", "/locked"]);
  expect(allFailed).toMatchObject({ added: 0, unsupported: 0, failed: 2, saveFailed: 0 });
  expect(allFailed.issues.map((item) => item.reason)).toEqual(["empty", "missing", "unreadable"]);
  expect(store.data.inbox).toEqual([]);
});

it("复制与保存失败都保留到批次详情，且成功项不受影响", async () => {
  const memory = new MemoryPlatform(templates);
  setPlatform(memory);
  const store = new Store("/Charter");
  await store.load();
  await memory.writeText("/in/正常.png", "normal");
  await memory.writeText("/in/复制失败.png", "copy failure");
  const originalCopy = memory.copyFile.bind(memory);
  vi.spyOn(memory, "copyFile").mockImplementation(async (from, to) => {
    if (from.endsWith("复制失败.png")) throw new Error("目标不可写");
    return originalCopy(from, to);
  });

  const progress: InboxImportProgress[] = [];
  const result = await addToInbox(store, ["/in"], (next) => progress.push(next));
  expect(result).toMatchObject({ added: 1, failed: 1, saveFailed: 0 });
  expect(progress.at(-1)).toMatchObject({ phase: "saving", total: 2, completed: 2, successful: 1 });
  expect(inboxProgressText(progress.at(-1)!)).toMatchObject({
    fileName: "已识别 1 份，1 份未能加入", completed: "已处理 2 份 · 1 份待保存",
  });
  expect(result.issues).toEqual([
    { path: "/in/复制失败.png", name: "复制失败.png", reason: "copy", detail: "目标不可写" },
  ]);

  await memory.writeText("/in/稍后保存.png", "save later");
  await memory.writeText("/in/一起保存.png", "save together");
  vi.spyOn(store, "ensureSaved").mockResolvedValue(false);
  const saveResult = await addToInbox(store, ["/in/稍后保存.png", "/in/一起保存.png"]);
  expect(saveResult).toMatchObject({ added: 0, failed: 0, saveFailed: 2 });
  expect(saveResult.issues).toEqual([
    { path: "/in/稍后保存.png", name: "稍后保存.png", reason: "save", detail: "副本和待整理记录尚未保存到数据文件夹" },
    { path: "/in/一起保存.png", name: "一起保存.png", reason: "save", detail: "副本和待整理记录尚未保存到数据文件夹" },
  ]);
});

it("连续拖入保留批次边界，结果只属于当前数据文件夹", () => {
  const memory = new MemoryPlatform(templates);
  setPlatform(memory);
  const router = new Router();
  router.startImport(["/one/a.pdf", "/one/b.xls"], null);
  router.startImport(["/two/c.docx"], null);
  const first = router.beginInboxImport("/Charter")!;
  expect(first.paths).toEqual(["/one/a.pdf", "/one/b.xls"]);
  expect(router.inboxPaths).toEqual(["/two/c.docx"]);
  router.finishInboxImport(first, { added: 1, duplicates: 0, unsupported: 1, failed: 0, saveFailed: 0,
    issues: [{ path: "/one/b.xls", name: "b.xls", reason: "unsupported" }] });
  const second = router.beginInboxImport("/Charter")!;
  expect(second.paths).toEqual(["/two/c.docx"]);
  router.finishInboxImport(second, { added: 1, duplicates: 0, unsupported: 0, failed: 0, saveFailed: 0, issues: [] });
  expect(router.inboxResultsFor("/Charter").map((result) => result.id)).toEqual([second.id, first.id]);

  router.syncInboxDataRoot("/Other");
  router.startImport(["/other/d.pdf"], null);
  const third = router.beginInboxImport("/Other")!;
  expect(router.inboxResultsFor("/Charter")).toEqual([]);
  router.finishInboxImport(third, { added: 1, duplicates: 0, unsupported: 0, failed: 0, saveFailed: 0, issues: [] });
  expect(router.inboxResultsFor("/Other")).toHaveLength(1);
  router.resetSelection();
  expect(router.inboxPaths).toEqual([]);
  expect(router.inboxResultsFor("/Other")).toEqual([]);
});

it("待整理所选文件直接打开导入向导，取消不重复入队，归档清理可随撤销恢复", async () => {
  const memory = new MemoryPlatform(templates);
  setPlatform(memory);
  const store = new Store("/Charter");
  await store.load();
  await installSampleData(store);
  await memory.writeText("/incoming/材料.pdf", "material");
  expect(await addToInbox(store, ["/incoming/材料.pdf"])).toMatchObject({ added: 1 });
  const item = store.data.inbox[0];
  const path = store.folder.abs(item.path);
  expect(inboxItemLookup(store)(path)).toMatchObject({ id: item.id, fileName: "材料.pdf", sourcePath: "/incoming/材料.pdf" });
  Object.defineProperty(memory, "os", { value: "windows", configurable: true });
  expect(inboxItemLookup(store)(path.replace(/\//g, "\\").toUpperCase())).toMatchObject({ id: item.id, fileName: "材料.pdf" });
  Object.defineProperty(memory, "os", { value: "web", configurable: true });

  const router = new Router();
  router.openImportWizard([path, path]);
  expect(router.sheet).toEqual({ kind: "importFiles", paths: [path] });
  expect(router.inboxPaths).toEqual([]);
  router.close();
  expect(router.sheet).toBeNull();
  expect(store.data.inbox.map((row) => row.id)).toEqual([item.id]);

  const company = store.data.companies[0];
  const typeID = store.data.library.documentTypes.find((type) => type.owner === "company")!.id;
  const before = store.data;
  const archived = await store.archiveBatch([{
    path, typeID, owner: { kind: "company", id: company.id }, originalFileName: item.fileName, sha256: item.sha256,
  }], [], { removeInboxIDs: [item.id] });
  const undoID = store.recordUndo("归档 1 份文件", before, archived.map((doc) => doc.filePath));
  expect(store.data.inbox).toEqual([]);
  expect(archived[0].originalFileName).toBe("材料.pdf");
  expect(archived[0].sourcePath).toBeUndefined();
  expect((await memory.stat(path)).exists).toBe(true);
  expect(undoID).toBeTruthy();
  expect(store.hasUndoID(undoID!)).toBe(true);
  store.isImporting = true;
  expect(store.undoID(undoID!)).toBe(false);
  expect(store.hasUndoID(undoID!)).toBe(true);
  store.isImporting = false;
  store.isLoading = true;
  expect(store.undoID(undoID!)).toBe(false);
  expect(store.hasUndoID(undoID!)).toBe(true);
  store.isLoading = false;
  expect(store.undoID(undoID!)).toBe(true);
  expect(store.hasUndoID(undoID!)).toBe(false);
  expect(store.undoID(undoID!)).toBe(false);
  expect(store.data.inbox.map((row) => row.id)).toEqual([item.id]);
});

it("归档文档与待整理移除同批保存，任一集合写入失败时一起回滚", async () => {
  const memory = new MemoryPlatform(templates);
  setPlatform(memory);
  const store = new Store("/Charter");
  await store.load();
  await installSampleData(store);
  await memory.writeText("/incoming/原件.pdf", "original");
  await addToInbox(store, ["/incoming/原件.pdf"]);
  const item = store.data.inbox[0];
  const company = store.data.companies[0];
  const typeID = store.data.library.documentTypes.find((type) => type.owner === "company")!.id;
  const beforeDocuments = store.data.documents.map((doc) => doc.id);
  const beforeFiles = [...memory.files.keys()].filter((path) => path.startsWith("/Charter/files/")).sort();

  const writeText = memory.writeText.bind(memory);
  let failed = false;
  vi.spyOn(memory, "writeText").mockImplementation(async (path, text) => {
    if (!failed && path.endsWith("/data/inbox.json")) {
      failed = true;
      throw new Error("模拟待整理集合写入失败");
    }
    await writeText(path, text);
  });

  await expect(store.archiveBatch([{
    path: store.folder.abs(item.path), typeID, owner: { kind: "company", id: company.id },
    originalFileName: item.fileName, sha256: item.sha256,
  }], [], { removeInboxIDs: [item.id] })).rejects.toThrow("模拟待整理集合写入失败");

  expect(store.data.documents.map((doc) => doc.id)).toEqual(beforeDocuments);
  expect(store.data.inbox.map((row) => row.id)).toEqual([item.id]);
  expect([...memory.files.keys()].filter((path) => path.startsWith("/Charter/files/")).sort()).toEqual(beforeFiles);

  const reopened = new Store("/Charter");
  await reopened.load();
  expect(reopened.data.documents.map((doc) => doc.id)).toEqual(beforeDocuments);
  expect(reopened.data.inbox.map((row) => row.id)).toEqual([item.id]);
});

it("切换数据根会丢弃旧根尚未开始的批次", () => {
  const memory = new MemoryPlatform(templates);
  setPlatform(memory);
  const router = new Router();
  router.syncInboxDataRoot("/Charter");
  router.startImport(["/submitted-under-old-root.pdf"], null);
  expect(router.inboxPaths).toHaveLength(1);

  router.syncInboxDataRoot("/Other");
  expect(router.inboxPaths).toEqual([]);
  expect(router.beginInboxImport("/Other")).toBeNull();
  expect(router.inboxResultsFor("/Charter")).toEqual([]);
});

it("会话内完整保留所有批次，过期的完成不会覆盖新活动批次", () => {
  const memory = new MemoryPlatform(templates);
  setPlatform(memory);
  const router = new Router();
  const outcome = { added: 1, duplicates: 0, unsupported: 0, failed: 0, saveFailed: 0, issues: [] };
  for (let n = 0; n < 22; n++) {
    router.startImport([`/batch/${n}.pdf`], null);
    const batch = router.beginInboxImport("/Charter")!;
    router.finishInboxImport(batch, outcome);
  }
  expect(router.inboxResultsFor("/Charter")).toHaveLength(22);

  router.startImport(["/old.pdf"], null);
  const stale = router.beginInboxImport("/Charter")!;
  router.resetSelection();
  router.syncInboxDataRoot("/Other");
  router.startImport(["/new.pdf"], null);
  const current = router.beginInboxImport("/Other")!;
  router.updateInboxImportStatus(stale, { phase: "recognizing", files: ["old.pdf"], total: 1, completed: 0, currentIndex: 0 });
  router.finishInboxImport(stale, outcome);
  expect(router.inboxImporting).toBe(true);
  expect(router.inboxImportStatus).toBe("正在准备 1 项…");
  expect(router.inboxResultsFor("/Charter")).toEqual([]);
  router.finishInboxImport(current, outcome);
  expect(router.inboxResultsFor("/Other").map((result) => result.id)).toEqual([current.id]);
});

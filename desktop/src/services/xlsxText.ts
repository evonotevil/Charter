const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_XML_CHARS = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 200_000;
const MAX_SHEETS = 64;
const MAX_COLUMN = 16_384;

type ZipEntry = {
  async(type: "string"): Promise<string>;
  _data?: { uncompressedSize?: number };
};

const elements = (parent: Element, name: string) => Array.from(parent.childNodes)
  .filter((node): node is Element => node.nodeType === 1 && (node as Element).localName === name);

const descendants = (parent: Element, name: string) => Array.from(parent.getElementsByTagNameNS("*", name));

function parseXml(xml: string, rootName: string): Element | null {
  if (!xml || xml.length > MAX_XML_CHARS) return null;
  const root = new DOMParser().parseFromString(xml, "application/xml").documentElement;
  if (!root || root.localName === "parsererror" || root.localName !== rootName) return null;
  return root;
}

async function xml(entry: ZipEntry | null | undefined, rootName: string): Promise<Element | null> {
  if (!entry || (entry._data?.uncompressedSize ?? 0) > MAX_XML_CHARS) return null;
  try { return parseXml(await entry.async("string"), rootName); }
  catch { return null; }
}

function relationshipId(element: Element): string {
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.localName === "id" && (attribute.prefix === "r" || attribute.namespaceURI?.includes("relationships"))) return attribute.value;
  }
  return element.getAttribute("r:id") ?? "";
}

function resolveTarget(base: string, target: string): string | null {
  if (!target || /^[a-z]+:/i.test(target)) return null;
  const rooted = target.startsWith("/");
  const cleanTarget = rooted ? target.slice(1) : target;
  if (rooted && !cleanTarget.startsWith("xl/")) return null;
  const parts = (rooted ? cleanTarget : `${base}/${cleanTarget}`).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!out.length) return null; out.pop(); }
    else out.push(part);
  }
  return out.join("/");
}

function columnIndex(reference: string): number | null {
  const letters = reference.match(/^[A-Za-z]+/)?.[0];
  if (!letters) return null;
  let value = 0;
  for (const letter of letters.toUpperCase()) value = value * 26 + letter.charCodeAt(0) - 64;
  return value > 0 && value <= MAX_COLUMN ? value - 1 : null;
}

function textContent(element: Element | undefined): string {
  if (!element) return "";
  return descendants(element, "t").filter((node) => {
    for (let parent = node.parentNode; parent && parent !== element; parent = parent.parentNode) {
      if (parent.nodeType === 1 && (parent as Element).localName === "rPh") return false;
    }
    return true;
  }).map((node) => node.textContent ?? "").join("");
}

interface DateContext { date1904: boolean; styles: boolean[] }

function excelDate(value: string, date1904: boolean): string | null {
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_465) return null;
  const day = Math.floor(serial);
  if (!date1904 && day === 60) return "1900-02-29";
  const adjusted = date1904 ? day : day - (day > 60 ? 1 : 0);
  const base = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 31);
  const date = new Date(base + adjusted * 86_400_000);
  if (!Number.isFinite(date.getTime())) return null;
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function dateFormat(code: string): boolean {
  const visible = code.toLowerCase()
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/_.|\*./g, "")
    .replace(/\[[^\]]*\]/g, "");
  return /y/.test(visible) && /[md]/.test(visible) || /d/.test(visible) && /m/.test(visible);
}

function dateStyles(root: Element | null): boolean[] {
  if (!root) return [];
  const custom = new Map<number, string>();
  const numFmts = descendants(root, "numFmts")[0];
  for (const format of numFmts ? elements(numFmts, "numFmt") : []) {
    const id = Number(format.getAttribute("numFmtId"));
    if (Number.isSafeInteger(id)) custom.set(id, format.getAttribute("formatCode") ?? "");
  }
  const builtInDate = (id: number) => id >= 14 && id <= 17 || id === 22 || id >= 27 && id <= 31 || id >= 34 && id <= 36 || id >= 50 && id <= 58;
  const cellXfs = descendants(root, "cellXfs")[0];
  return (cellXfs ? elements(cellXfs, "xf") : []).map((style) => {
    const id = Number(style.getAttribute("numFmtId"));
    return builtInDate(id) || dateFormat(custom.get(id) ?? "");
  });
}

function cellText(cell: Element, sharedStrings: string[], dates: DateContext): string {
  const type = cell.getAttribute("t") ?? "";
  if (type === "inlineStr") return textContent(elements(cell, "is")[0]);
  const valueElement = elements(cell, "v")[0];
  if (!valueElement) return "";
  const value = valueElement.textContent ?? "";
  if (!value.trim()) return "";
  if (type === "s") {
    const index = Number(value);
    return Number.isSafeInteger(index) && index >= 0 ? sharedStrings[index] ?? "" : "";
  }
  if (type === "b") return value === "1" ? "TRUE" : value === "0" ? "FALSE" : value;
  if (type === "d") return value.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? value;
  const style = Number(cell.getAttribute("s"));
  if ((!type || type === "n") && Number.isSafeInteger(style) && dates.styles[style]) return excelDate(value, dates.date1904) ?? value;
  return value;
}

function worksheetText(root: Element, name: string, sharedStrings: string[], dates: DateContext): string {
  let remaining = MAX_TEXT_CHARS;
  const parts: string[] = [];
  const append = (value: string) => {
    if (remaining <= 0 || !value) return;
    const chunk = value.slice(0, remaining);
    parts.push(chunk);
    remaining -= chunk.length;
  };
  append(name.trim());
  const sheetData = descendants(root, "sheetData")[0];
  if (!sheetData) return parts.join("").trim();
  let previousRow = 0;
  for (const row of elements(sheetData, "row")) {
    if (remaining <= 0) break;
    const declaredRow = Number(row.getAttribute("r"));
    const rowNumber = Number.isSafeInteger(declaredRow) && declaredRow > previousRow ? declaredRow : previousRow + 1;
    append("\n".repeat(Math.min(rowNumber - previousRow, 2, remaining)));
    previousRow = rowNumber;
    let previousColumn = -1;
    for (const cell of elements(row, "c")) {
      if (remaining <= 0) break;
      const declaredColumn = columnIndex(cell.getAttribute("r") ?? "");
      const column = declaredColumn !== null && declaredColumn > previousColumn ? declaredColumn : previousColumn + 1;
      const separators = previousColumn < 0 ? column : column - previousColumn;
      append("\t".repeat(Math.min(Math.max(separators, 0), remaining)));
      append(cellText(cell, sharedStrings, dates));
      previousColumn = column;
    }
  }
  return parts.join("").replace(/[ \f\v]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Reads the visible/cached text from an OOXML workbook. It does not evaluate formulas or macros. */
export async function xlsxText(bytes: Uint8Array): Promise<string[]> {
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) return [""];
  try {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(bytes);
    const workbook = await xml(zip.file("xl/workbook.xml") as ZipEntry | null, "workbook");
    const relationships = await xml(zip.file("xl/_rels/workbook.xml.rels") as ZipEntry | null, "Relationships");
    if (!workbook || !relationships) return [""];

    const targets = new Map<string, string>();
    let sharedTarget = "xl/sharedStrings.xml";
    let stylesTarget = "xl/styles.xml";
    for (const rel of elements(relationships, "Relationship")) {
      if ((rel.getAttribute("TargetMode") ?? "").toLowerCase() === "external") continue;
      const id = rel.getAttribute("Id") ?? "";
      const target = resolveTarget("xl", rel.getAttribute("Target") ?? "");
      const type = rel.getAttribute("Type") ?? "";
      if (id && target && /(?:^|\/)worksheet$/i.test(type)) targets.set(id, target);
      else if (target && /(?:^|\/)sharedStrings$/i.test(type)) sharedTarget = target;
      else if (target && /(?:^|\/)styles$/i.test(type)) stylesTarget = target;
    }

    const sharedRoot = await xml(zip.file(sharedTarget) as ZipEntry | null, "sst");
    const sharedStrings = sharedRoot ? elements(sharedRoot, "si").map((item) => textContent(item)) : [];
    const styleRoot = await xml(zip.file(stylesTarget) as ZipEntry | null, "styleSheet");
    const dates: DateContext = {
      date1904: ["1", "true"].includes(descendants(workbook, "workbookPr")[0]?.getAttribute("date1904") ?? ""),
      styles: dateStyles(styleRoot),
    };
    const sheetsRoot = descendants(workbook, "sheets")[0];
    const pages: string[] = [];
    let workbookRemaining = MAX_TEXT_CHARS;
    for (const sheet of (sheetsRoot ? elements(sheetsRoot, "sheet") : []).slice(0, MAX_SHEETS)) {
      if (workbookRemaining <= 0) break;
      const target = targets.get(relationshipId(sheet));
      if (!target) continue;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const root = await xml(zip.file(target) as ZipEntry | null, "worksheet");
      if (root) {
        const page = worksheetText(root, sheet.getAttribute("name") ?? "", sharedStrings, dates).slice(0, workbookRemaining);
        pages.push(page);
        workbookRemaining -= page.length;
      }
    }
    return pages.length ? pages : [""];
  } catch {
    // Password-protected, damaged, or non-OOXML files stay in the inbox for manual classification.
    return [""];
  }
}

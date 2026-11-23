import type { PDFFont } from "pdf-lib";

function tokenize(text: string): string[] {
  return text.replace(/[\x00-\x1f]/g, " ").match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|\s+|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) ?? [text];
}

export function wrapPDFText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  const flush = () => { if (line.trim()) lines.push(line.trimEnd()); line = ""; };
  for (const token of tokenize(text)) {
    if (font.widthOfTextAtSize(line + token, size) <= maxWidth) { line += token; continue; }
    if (line.trim()) flush();
    if (font.widthOfTextAtSize(token, size) <= maxWidth) { line = token.trimStart(); continue; }
    for (const char of [...token]) {
      if (font.widthOfTextAtSize(line + char, size) > maxWidth && line) flush();
      line += char;
    }
  }
  flush();
  return lines.length ? lines : [""];
}

// 测试样例里的 PDF 多数是假文件，处理会失败；测试关心的不是这些文件时，一律“原样放入”。
import { type BuildOptions, type PacketItem, PacketFailuresError, buildPacket } from "../services/packets";
import type { Company, PacketTemplate } from "../domain/models";
import type { Store } from "../state/store";
export async function buildAsIs(items: PacketItem[], t: PacketTemplate, c: Company, s: Store, o: BuildOptions = {}) {
  try { return await buildPacket(items, t, c, s, o); }
  catch (e) {
    if (!(e instanceof PacketFailuresError)) throw e;
    return buildPacket(items, t, c, s, { ...o, failed: Object.fromEntries(e.failures.map((f) => [f.id, "asis" as const])) });
  }
}

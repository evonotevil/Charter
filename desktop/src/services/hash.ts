// 内容哈希：去重用。只在本机计算，不联网。
import { platform } from "../platform/platform";

export async function sha256Bytes(b: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", b);
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export async function sha256File(path: string): Promise<string> {
  return sha256Bytes(await platform().readBytes(path));
}

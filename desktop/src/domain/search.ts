// 搜索时简繁通用：常见公司名用字的繁简对照（浏览器里没有系统的繁简转换）。

const pairs = "遠远瀾澜國国際际貿贸灣湾華华東东業业資资產产開开發发實实興兴億亿銀银號号鋼钢電电網网運运達达聯联證证會会團团務务匯汇豐丰寶宝長长龍龙門门環环廣广讓让亞亚歐欧澳澳萬万與与為为從从於于來来個个們们買买賣卖貨货幣币際际經经濟济濱滨島岛橋桥灣湾韓韩臺台區区縣县鎮镇廠厂場场設设計计創创訊讯數数據据術术機机構构館馆醫医藥药療疗險险財财稅税務务齊齐準准標标線线車车輪轮鐵铁儲储藍蓝綠绿紅红黃黄緣缘麗丽鳳凤鴻鸿園园圓圆廈厦樓楼億亿禮礼義义觀观協协會会員员師师學学習习書书畫画視视聽听訂订購购勝胜義义";
const t2s = new Map<string, string>(), s2t = new Map<string, string>();
for (let i = 0; i + 1 < pairs.length; i += 2) { t2s.set(pairs[i], pairs[i + 1]); if (!s2t.has(pairs[i + 1])) s2t.set(pairs[i + 1], pairs[i]); }

export function searchForms(value: string): Set<string> {
  const base = value.trim().normalize("NFKC").toLowerCase();
  if (!base) return new Set();
  const simp = [...base].map((c) => t2s.get(c) ?? c).join("");
  const trad = [...base].map((c) => s2t.get(c) ?? c).join("");
  return new Set([base, simp, trad]);
}

export function matchesSearch(terms: Set<string>, sources: string[]): boolean {
  return sources.some((s) => { const forms = searchForms(s); return [...terms].some((t) => [...forms].some((f) => f.includes(t))); });
}

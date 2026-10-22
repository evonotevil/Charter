// 小工具：剩余天数的说法。

export const leftText = (n: number) => (n < 0 ? `已逾期 ${-n} 天` : n === 0 ? "今天" : `${n} 天后`);

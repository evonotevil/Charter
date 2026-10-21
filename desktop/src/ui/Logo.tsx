// Charter 5 标志：鲜绿立体方块里的“打勾的 C”（规范/charter-grove/README.md · 标志）。
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={(size * 128) / 120} viewBox="0 0 120 128" aria-hidden focusable="false" style={{ display: "block", flex: "none" }}>
      <rect x="4" y="12" width="112" height="112" rx="30" fill="#368A00" />
      <rect x="4" y="4" width="112" height="112" rx="30" fill="#58CC02" />
      <path d="M84 36 A32 32 0 1 0 84 84" fill="none" stroke="#FFFFFF" strokeWidth="15" strokeLinecap="round" />
      <path d="M66 60 L76 70 L96 46" fill="none" stroke="#FFFFFF" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

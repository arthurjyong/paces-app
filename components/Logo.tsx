// The PACES Buddy mark (speech bubble + ECG trace), shared by the sidebar
// header and the static pages. Pure SVG, no client hooks — usable from both
// server and client components. Mirrors app/icon.svg (the favicon).

export default function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-hidden="true">
      <rect width="100" height="100" rx="24" fill="#0d9488" />
      <g fill="#ffffff">
        <rect x="16" y="24" width="68" height="42" rx="13" />
        <path d="M30 62 L30 83 L51 64 Z" />
      </g>
      <polyline
        points="26,45 39,45 45,32 51,58 57,45 74,45"
        fill="none"
        stroke="#0d9488"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

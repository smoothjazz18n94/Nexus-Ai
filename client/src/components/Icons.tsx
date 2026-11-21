import type { SVGProps } from "react";

const base: SVGProps<SVGSVGElement> = {
  width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
};
const I = (d: string) => (p: SVGProps<SVGSVGElement>) => <svg {...base} {...p}><path d={d} /></svg>;

export const PlusIcon = I("M12 5v14M5 12h14");
export const SidebarIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base} {...p}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></svg>;
export const SearchIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base} {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4-4" /></svg>;
export const SendIcon = I("M12 19V5M5.5 11.5 12 5l6.5 6.5");
export const StopIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base} {...p} fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>;
export const CopyIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base} width={15} height={15} {...p}><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></svg>;
export const CheckIcon = I("m5 12.5 4.5 4.5L19 7.5");
export const RetryIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base} width={15} height={15} {...p}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>;
export const PencilIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base} width={15} height={15} {...p}><path d="M4 20h4L19 9l-4-4L4 16v4Z" /></svg>;
export const TrashIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base} width={15} height={15} {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>;
export const SunIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base} {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
export const MoonIcon = I("M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z");
export const CloseIcon = I("M6 6l12 12M18 6 6 18");
export const AlertIcon = (p: SVGProps<SVGSVGElement>) => <svg {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5M12 16v.01" /></svg>;

/** Nexus mark: two nodes joined by a stroke. */
export const Mark = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
    <rect width="32" height="32" rx="8" fill="var(--accent)" />
    <path d="M9 22V10l14 12V10" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <circle cx="9" cy="10" r="2.2" fill="#fff" /><circle cx="23" cy="22" r="2.2" fill="#fff" />
  </svg>
);

import type { SVGProps } from "react";

export function UltaMark({
  accent = false,
  ...props
}: SVGProps<SVGSVGElement> & { readonly accent?: boolean }) {
  return (
    <svg {...props} viewBox="28.5 22.5 71 81" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M36 30V68A28 28 0 0 0 92 68V30"
        stroke="currentColor"
        strokeWidth="15"
        strokeLinecap="round"
      />
      <path
        d="M59 54H69A3 3 0 0 1 72 57V73A3 3 0 0 1 69 76H59A3 3 0 0 1 56 73V57A3 3 0 0 1 59 54Z"
        fill={accent ? "var(--primary)" : "currentColor"}
      />
    </svg>
  );
}

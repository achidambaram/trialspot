import type { Readiness } from "@/lib/types";

const config: Record<Readiness, { bg: string; text: string; label: string }> = {
  READY: { bg: "bg-green-600", text: "text-green-100", label: "READY" },
  PARTIAL: { bg: "bg-yellow-600", text: "text-yellow-100", label: "PARTIAL" },
  BLOCKED: { bg: "bg-red-600", text: "text-red-100", label: "BLOCKED" },
  UNKNOWN: { bg: "bg-gray-600", text: "text-gray-100", label: "UNKNOWN" },
};

export function ReadinessBadge({ readiness }: { readiness: Readiness }) {
  const c = config[readiness];
  return (
    <span
      className={`${c.bg} ${c.text} px-4 py-2 rounded-lg text-sm font-bold tracking-wide`}
    >
      {c.label}
    </span>
  );
}

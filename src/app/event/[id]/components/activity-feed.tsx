import type { ActivityEvent } from "@/lib/types";
import { useEffect, useRef } from "react";

const typeIcon: Record<string, string> = {
  inspection_update: "✓",
  zone_enter: "→",
  zone_exit: "←",
  alert_fired: "🔴",
  readiness_changed: "◆",
  task_created: "☐",
  task_resolved: "☑",
  raw_input: "?",
  contradiction_detected: "⚡",
};

const typeColor: Record<string, string> = {
  inspection_update: "text-green-400",
  zone_enter: "text-blue-400",
  zone_exit: "text-blue-300",
  alert_fired: "text-red-400",
  readiness_changed: "text-purple-400",
  task_created: "text-yellow-400",
  task_resolved: "text-green-300",
  raw_input: "text-gray-500",
  contradiction_detected: "text-red-500",
};

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function describeEvent(event: ActivityEvent): string {
  const p = event.payload as Record<string, string>;
  switch (event.type) {
    case "inspection_update":
      return `Verified: ${p.item_label || p.item_name}${p.note ? ` — "${p.note}"` : ""}`;
    case "zone_enter":
      return `Entered ${p.zone_label || p.zone_id}`;
    case "zone_exit":
      return `Exited ${p.zone_label || p.zone_id}${p.dwell_ms ? ` (${Math.round(Number(p.dwell_ms) / 1000)}s)` : ""}`;
    case "alert_fired":
      return `ALERT: ${p.message || p.alert_type}`;
    case "readiness_changed":
      return `Readiness: ${p.readiness}${p.reason ? ` — ${p.reason}` : ""}`;
    case "task_created":
      return `Task created: ${p.item_label || ""}`;
    case "task_resolved":
      return `Task resolved: ${p.title || ""}`;
    case "raw_input":
      return `Unmatched input: "${p.raw_text || ""}"`;
    case "contradiction_detected":
      return `Contradiction: ${p.item_label} (zone: ${p.item_zone}, you're in: ${p.current_zone || "none"})`;
    default:
      return event.type;
  }
}

export function ActivityFeed({
  activities,
}: {
  activities: ActivityEvent[];
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activities.length]);

  return (
    <div className="bg-gray-900 rounded-lg p-4 h-full flex flex-col">
      <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">
        Activity Feed
      </h2>

      <div className="flex-1 overflow-auto space-y-1">
        {activities.length === 0 && (
          <p className="text-sm text-gray-600">No activity yet.</p>
        )}
        {activities.map((event) => (
          <div
            key={event.id}
            className="flex items-start gap-2 py-1 text-sm"
          >
            <span className="text-gray-600 text-xs whitespace-nowrap mt-0.5">
              {formatTime(event.timestamp)}
            </span>
            <span className={typeColor[event.type] || "text-gray-400"}>
              {typeIcon[event.type] || "·"}
            </span>
            <span className="text-gray-300">{describeEvent(event)}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

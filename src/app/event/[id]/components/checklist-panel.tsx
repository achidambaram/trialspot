import type { ChecklistItem, Zone } from "@/lib/types";

const statusIcon: Record<string, string> = {
  verified: "✓",
  flagged: "⚠",
  unverified: "○",
};

const statusColor: Record<string, string> = {
  verified: "text-green-400",
  flagged: "text-yellow-400",
  unverified: "text-gray-500",
};

const critColor: Record<string, string> = {
  critical: "border-red-500/30",
  required: "border-yellow-500/30",
  nice_to_have: "border-gray-700",
};

export function ChecklistPanel({
  items,
  zones,
}: {
  items: ChecklistItem[];
  zones: Zone[];
}) {
  const zoneMap = new Map(zones.map((z) => [z.id, z]));

  // Group items by zone
  const grouped = new Map<string, ChecklistItem[]>();
  for (const item of items) {
    const list = grouped.get(item.zone_id) || [];
    list.push(item);
    grouped.set(item.zone_id, list);
  }

  const verified = items.filter((i) => i.status === "verified").length;

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
          Checklist
        </h2>
        <span className="text-xs text-gray-500">
          {verified}/{items.length}
        </span>
      </div>

      <div className="space-y-4">
        {Array.from(grouped.entries()).map(([zoneId, zoneItems]) => {
          const zone = zoneMap.get(zoneId);
          return (
            <div key={zoneId}>
              <p className="text-xs text-gray-500 mb-1 uppercase">
                {zone?.label || zoneId}
              </p>
              <div className="space-y-1">
                {zoneItems.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded border ${critColor[item.criticality]} bg-gray-800/50`}
                  >
                    <span className={`text-sm ${statusColor[item.status]}`}>
                      {statusIcon[item.status]}
                    </span>
                    <span className="text-sm text-gray-200 flex-1">
                      {item.label}
                    </span>
                    {item.criticality === "critical" && (
                      <span className="text-[10px] text-red-400 uppercase">
                        crit
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

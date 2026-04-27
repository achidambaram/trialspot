"use client";

import { useState, useMemo } from "react";
import type { Zone, ChecklistItem, Task, SpatialSnapshot, SpatialRealAlert, Operator } from "@/lib/types";

// Colors for different operators
const OPERATOR_COLORS = [
  "#3b82f6", // blue
  "#8b5cf6", // purple
  "#f59e0b", // amber
  "#10b981", // emerald
  "#ec4899", // pink
  "#06b6d4", // cyan
];

// Zone positions — placed as they're discovered
// Each new zone gets placed in the next available slot
const SLOT_POSITIONS = [
  { x: 5,  y: 5,  w: 28, h: 28 },
  { x: 38, y: 5,  w: 28, h: 28 },
  { x: 71, y: 5,  w: 24, h: 28 },
  { x: 5,  y: 40, w: 28, h: 28 },
  { x: 38, y: 40, w: 28, h: 28 },
  { x: 71, y: 40, w: 24, h: 28 },
];

interface InteractiveMapProps {
  zones: Zone[];
  items: ChecklistItem[];
  tasks: Task[];
  spatial: SpatialSnapshot;
  alerts: SpatialRealAlert[];
  operators?: Operator[];
}

export function InteractiveMap({ zones, items, tasks, spatial, alerts, operators = [] }: InteractiveMapProps) {
  const [selectedZone, setSelectedZone] = useState<string | null>(null);

  // Only show zones that have been visited (discovered by the operator)
  const discoveredZoneIds = useMemo(() => {
    const visited = new Set(spatial.zones_visited);
    // Also include current zone (operator just entered it)
    if (spatial.current_zone) visited.add(spatial.current_zone);
    return visited;
  }, [spatial.zones_visited, spatial.current_zone]);

  const discoveredZones = zones.filter(z => discoveredZoneIds.has(z.id));
  const undiscoveredCount = zones.length - discoveredZones.length;

  // Assign positions to discovered zones in order of discovery
  const zonePositions = useMemo(() => {
    const positions = new Map<string, typeof SLOT_POSITIONS[0]>();
    // Use visit order from zones_visited array
    const ordered = [...spatial.zones_visited];
    if (spatial.current_zone && !ordered.includes(spatial.current_zone)) {
      ordered.push(spatial.current_zone);
    }
    ordered.forEach((zoneId, i) => {
      if (i < SLOT_POSITIONS.length) {
        positions.set(zoneId, SLOT_POSITIONS[i]);
      }
    });
    return positions;
  }, [spatial.zones_visited, spatial.current_zone]);

  const selectedZoneData = selectedZone ? zones.find(z => z.id === selectedZone) : null;
  const selectedItems = selectedZone ? items.filter(i => i.zone_id === selectedZone) : [];
  const selectedTasks = selectedZone ? tasks.filter(t => t.related_zone_id === selectedZone && t.status === "open") : [];
  const selectedAlerts = selectedZone ? alerts.filter(a => a.related_zone_id === selectedZone) : [];

  function getZoneStatus(zoneId: string): "clear" | "issues" | "blocked" | "current" {
    if (spatial.current_zone === zoneId) return "current";

    const zoneItems = items.filter(i => i.zone_id === zoneId);
    const zoneTasks = tasks.filter(t => t.related_zone_id === zoneId && t.status === "open");
    const hasCriticalUnverified = zoneItems.some(i => i.criticality === "critical" && i.status !== "verified");

    if (hasCriticalUnverified || zoneTasks.some(t => t.type === "contradiction")) return "blocked";
    if (zoneTasks.length > 0 || zoneItems.some(i => i.status === "unverified" && i.criticality !== "nice_to_have")) return "issues";
    return "clear";
  }

  const statusColors: Record<string, { fill: string; stroke: string; text: string }> = {
    current: { fill: "#1e3a5f", stroke: "#3b82f6", text: "#93c5fd" },
    clear:   { fill: "#14532d", stroke: "#22c55e", text: "#86efac" },
    issues:  { fill: "#422006", stroke: "#f59e0b", text: "#fcd34d" },
    blocked: { fill: "#450a0a", stroke: "#ef4444", text: "#fca5a5" },
  };

  // Empty state — no zones discovered yet
  if (discoveredZones.length === 0) {
    return (
      <div className="bg-gray-900 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">
          Live Floor Plan
        </h2>
        <div className="w-full rounded-lg bg-gray-800 flex flex-col items-center justify-center py-12 px-4">
          <div className="w-16 h-16 rounded-full border-2 border-dashed border-gray-700 flex items-center justify-center mb-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </div>
          <p className="text-sm text-gray-500 text-center">
            Map builds as you walk through the room
          </p>
          <p className="text-xs text-gray-600 text-center mt-1">
            Enter a zone to start mapping
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
          Live Floor Plan
        </h2>
        <div className="flex gap-2 text-[10px]">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />you</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" />clear</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500" />issues</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />blocked</span>
        </div>
      </div>

      {/* SVG Floor Plan — progressively revealed */}
      <svg
        viewBox="0 0 100 75"
        className="w-full rounded-lg bg-gray-800"
        style={{ aspectRatio: "100/75" }}
      >
        {/* Undiscovered zone hints — faint outlines */}
        {undiscoveredCount > 0 && (
          <text x="50" y="73" textAnchor="middle" fill="#374151" fontSize="2">
            {undiscoveredCount} zone{undiscoveredCount > 1 ? "s" : ""} undiscovered
          </text>
        )}

        {/* Connection lines between adjacent discovered zones */}
        {discoveredZones.length > 1 && discoveredZones.map((zone, i) => {
          if (i === 0) return null;
          const pos = zonePositions.get(zone.id);
          const prevPos = zonePositions.get(discoveredZones[i - 1].id);
          if (!pos || !prevPos) return null;
          return (
            <line
              key={`line-${zone.id}`}
              x1={prevPos.x + prevPos.w / 2}
              y1={prevPos.y + prevPos.h / 2}
              x2={pos.x + pos.w / 2}
              y2={pos.y + pos.h / 2}
              stroke="#374151"
              strokeWidth="0.4"
              strokeDasharray="2,2"
            />
          );
        })}

        {/* Discovered Zones */}
        {discoveredZones.map(zone => {
          const layout = zonePositions.get(zone.id);
          if (!layout) return null;
          const status = getZoneStatus(zone.id);
          const colors = statusColors[status];
          const isCurrent = status === "current";
          const zoneItems = items.filter(i => i.zone_id === zone.id);
          const verified = zoneItems.filter(i => i.status === "verified").length;
          const total = zoneItems.length;
          const openTasks = tasks.filter(t => t.related_zone_id === zone.id && t.status === "open");
          const isSelected = selectedZone === zone.id;

          return (
            <g
              key={zone.id}
              onClick={() => setSelectedZone(isSelected ? null : zone.id)}
              className="cursor-pointer"
            >
              {/* Fade-in effect zone */}
              <rect
                x={layout.x}
                y={layout.y}
                width={layout.w}
                height={layout.h}
                rx="1.5"
                fill={colors.fill}
                stroke={isSelected ? "#ffffff" : colors.stroke}
                strokeWidth={isSelected ? "0.8" : "0.4"}
                opacity={0.9}
              >
                {/* Appear animation */}
                <animate attributeName="opacity" from="0" to="0.9" dur="0.6s" fill="freeze" begin="0s" />
              </rect>

              {/* Current zone pulse */}
              {isCurrent && (
                <rect
                  x={layout.x}
                  y={layout.y}
                  width={layout.w}
                  height={layout.h}
                  rx="1.5"
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth="0.3"
                >
                  <animate attributeName="opacity" values="0.5;0;0.5" dur="2s" repeatCount="indefinite" />
                </rect>
              )}

              {/* Zone label */}
              <text
                x={layout.x + layout.w / 2}
                y={layout.y + layout.h / 2 - 3}
                textAnchor="middle"
                fill={colors.text}
                fontSize="2.5"
                fontWeight="600"
              >
                {zone.label}
              </text>

              {/* Progress bar */}
              <rect
                x={layout.x + 2}
                y={layout.y + layout.h / 2 + 1}
                width={layout.w - 4}
                height="1.5"
                rx="0.75"
                fill="#111827"
              />
              <rect
                x={layout.x + 2}
                y={layout.y + layout.h / 2 + 1}
                width={total > 0 ? ((layout.w - 4) * verified) / total : 0}
                height="1.5"
                rx="0.75"
                fill={colors.stroke}
              />

              {/* Progress text */}
              <text
                x={layout.x + layout.w / 2}
                y={layout.y + layout.h / 2 + 6}
                textAnchor="middle"
                fill={colors.text}
                fontSize="1.8"
                opacity="0.8"
              >
                {verified}/{total} checked
              </text>

              {/* Operator position dots */}
              {operators
                .filter(op => op.current_zone_id === zone.id)
                .map((op, i) => {
                  const color = OPERATOR_COLORS[operators.indexOf(op) % OPERATOR_COLORS.length];
                  const cx = layout.x + 3 + i * 3.5;
                  const cy = layout.y + 3;
                  return (
                    <g key={op.id}>
                      <circle cx={cx} cy={cy} r="1.5" fill={color}>
                        <animate attributeName="r" values="1.2;2;1.2" dur="1.5s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="1;0.5;1" dur="1.5s" repeatCount="indefinite" />
                      </circle>
                      <text x={cx} y={cy + 4} textAnchor="middle" fill={color} fontSize="1.5">
                        {op.name.split(" ").pop()?.slice(0, 3) || "Op"}
                      </text>
                    </g>
                  );
                })
              }
              {/* Fallback: show single dot from spatial snapshot if no operators table */}
              {operators.length === 0 && isCurrent && (
                <circle cx={layout.x + 3} cy={layout.y + 3} r="1.5" fill="#3b82f6">
                  <animate attributeName="r" values="1.2;2;1.2" dur="1.5s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="1;0.5;1" dur="1.5s" repeatCount="indefinite" />
                </circle>
              )}

              {/* Issue pins */}
              {openTasks.map((task, i) => {
                const pinX = layout.x + layout.w - 3 - i * 3;
                const pinY = layout.y + 3;
                const pinColor = task.type === "contradiction" ? "#ef4444" : "#f59e0b";
                return (
                  <g key={task.id}>
                    <circle cx={pinX} cy={pinY} r="1.2" fill={pinColor} />
                    <text x={pinX} y={pinY + 0.5} textAnchor="middle" fill="white" fontSize="1.4" fontWeight="bold">!</text>
                  </g>
                );
              })}

              {/* Clear checkmark */}
              {status === "clear" && (
                <text x={layout.x + layout.w - 3} y={layout.y + layout.h - 2} textAnchor="middle" fill="#22c55e" fontSize="3">✓</text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Operator legend */}
      {operators.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {operators.map((op, i) => (
            <div key={op.id} className="flex items-center gap-1 text-[10px]">
              <span
                className="w-2 h-2 rounded-full animate-pulse"
                style={{ backgroundColor: OPERATOR_COLORS[i % OPERATOR_COLORS.length] }}
              />
              <span className="text-gray-400">{op.name}</span>
              {op.current_zone_id && (
                <span className="text-gray-600">
                  ({zones.find(z => z.id === op.current_zone_id)?.label || "..."})
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Selected Zone Detail */}
      {selectedZoneData && (
        <div className="mt-3 p-3 bg-gray-800 rounded-lg border border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-200">{selectedZoneData.label}</h3>
            <button onClick={() => setSelectedZone(null)} className="text-xs text-gray-500 hover:text-gray-300">✕</button>
          </div>

          <div className="space-y-1 mb-2">
            {selectedItems.map(item => (
              <div key={item.id} className="flex items-center gap-2 text-xs">
                <span className={
                  item.status === "verified" ? "text-green-400" :
                  item.status === "flagged" ? "text-red-400" : "text-gray-500"
                }>
                  {item.status === "verified" ? "✓" : item.status === "flagged" ? "✗" : "○"}
                </span>
                <span className="text-gray-300 flex-1">{item.label}</span>
                {item.criticality === "critical" && <span className="text-[9px] text-red-400 uppercase">crit</span>}
                {item.note && <span className="text-[9px] text-gray-500 truncate max-w-[120px]">{item.note}</span>}
              </div>
            ))}
          </div>

          {selectedTasks.length > 0 && (
            <div className="border-t border-gray-700 pt-2 mt-2">
              <p className="text-[10px] text-gray-500 uppercase mb-1">Open Tasks</p>
              {selectedTasks.map(task => (
                <div key={task.id} className="text-xs text-yellow-400 flex items-center gap-1">
                  <span>!</span><span>{task.title}</span>
                </div>
              ))}
            </div>
          )}

          {selectedAlerts.length > 0 && (
            <div className="border-t border-gray-700 pt-2 mt-2">
              <p className="text-[10px] text-gray-500 uppercase mb-1">Alerts</p>
              {selectedAlerts.map(alert => (
                <div key={alert.id} className="text-xs text-red-400">{alert.message}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

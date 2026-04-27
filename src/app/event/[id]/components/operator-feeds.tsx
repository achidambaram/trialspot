"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { Operator, Zone } from "@/lib/types";

const OPERATOR_COLORS = [
  "#3b82f6", "#8b5cf6", "#f59e0b", "#10b981", "#ec4899", "#06b6d4",
];

interface LiveFrame {
  operator_id: string;
  operator_name: string;
  frame: string; // data URL
  zone_id: string | null;
  timestamp: number;
}

interface OperatorFeedsProps {
  operators: Operator[];
  zones: Zone[];
  eventId: string;
  onLiveOperatorsChange?: (liveIds: Set<string>) => void;
}

export function OperatorFeeds({ operators, zones, eventId, onLiveOperatorsChange }: OperatorFeedsProps) {
  const [frames, setFrames] = useState<Map<string, LiveFrame>>(new Map());
  const [selectedOp, setSelectedOp] = useState<string | null>(null);
  const [hiddenOps, setHiddenOps] = useState<Set<string>>(new Set());
  const [, setTick] = useState(0); // force re-render for stale check

  // Subscribe to live feed broadcast channel
  useEffect(() => {
    console.log("[OperatorFeeds] subscribing to feed:" + eventId);
    const channel = supabase
      .channel(`feed:${eventId}`)
      .on("broadcast", { event: "frame" }, ({ payload }: { payload: LiveFrame }) => {
        console.log("[OperatorFeeds] got frame from", payload.operator_name, payload.operator_id);
        setHiddenOps((prev) => {
          if (prev.has(payload.operator_id)) {
            const next = new Set(prev);
            next.delete(payload.operator_id);
            return next;
          }
          return prev;
        });
        setFrames((prev) => {
          const next = new Map(prev);
          next.set(payload.operator_id, payload);
          return next;
        });
      })
      .subscribe((status: string) => {
        console.log("[OperatorFeeds] channel status:", status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId]);

  // Force re-render every 3s to update stale indicators + report live operators
  const prevLiveRef = useRef<string>("");
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
      // Report live operator IDs to parent
      if (onLiveOperatorsChange) {
        const now = Date.now();
        const liveIds = new Set<string>();
        for (const [id, f] of frames) {
          if (now - f.timestamp < 5000) liveIds.add(id);
        }
        const key = Array.from(liveIds).sort().join(",");
        if (key !== prevLiveRef.current) {
          prevLiveRef.current = key;
          onLiveOperatorsChange(liveIds);
        }
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [frames, onLiveOperatorsChange]);

  // Build combined list: known operators + any unknown broadcasters
  const activeOps = operators.filter((op) => op.is_active);
  const knownIds = new Set(activeOps.map((op) => op.id));
  const unknownBroadcasters = Array.from(frames.entries())
    .filter(([id]) => !knownIds.has(id))
    .map(([, frame]) => frame);

  const allFeeds: Array<{
    id: string;
    name: string;
    zone: Zone | undefined;
    frame: LiveFrame | undefined;
    isLive: boolean;
  }> = [
    // Known operators
    ...activeOps.map((op, _i) => {
      const frame = frames.get(op.id);
      const isLive = !!frame && Date.now() - frame.timestamp < 5000;
      const zone = zones.find((z) => z.id === op.current_zone_id);
      return { id: op.id, name: op.name, zone, frame, isLive };
    }),
    // Unknown broadcasters (operator registered but dashboard hasn't refreshed yet)
    ...unknownBroadcasters.map((f) => ({
      id: f.operator_id,
      name: f.operator_name || "Operator",
      zone: f.zone_id ? zones.find((z) => z.id === f.zone_id) : undefined,
      frame: f,
      isLive: Date.now() - f.timestamp < 5000,
    })),
  ];

  const liveCount = allFeeds.filter((f) => f.isLive).length;

  const visibleFeeds = allFeeds.filter((f) => !hiddenOps.has(f.id));

  if (visibleFeeds.length === 0) {
    return (
      <div className="p-4 flex flex-col items-center justify-center h-full text-center">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
        </svg>
        <p className="text-xs text-gray-500 mt-2">No operators connected</p>
        <p className="text-[10px] text-gray-600 mt-1">
          Share the event link — phones auto-join as operators
        </p>
      </div>
    );
  }

  // Selected operator fullscreen
  if (selectedOp) {
    const feed = visibleFeeds.find((f) => f.id === selectedOp);
    if (feed) {
      return (
        <div className="flex flex-col h-full">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 shrink-0">
            <button
              onClick={() => setSelectedOp(null)}
              className="text-gray-400 hover:text-white text-xs"
            >
              ← All Feeds
            </button>
            <span className="text-xs font-medium text-gray-200 flex-1 text-right">
              {feed.name}
            </span>
            {feed.zone && (
              <span className="text-[10px] text-blue-400 bg-blue-900/30 px-1.5 py-0.5 rounded">
                {feed.zone.label}
              </span>
            )}
          </div>
          <div className="flex-1 bg-black flex items-center justify-center relative">
            {feed.isLive && feed.frame ? (
              <>
                <img
                  src={feed.frame.frame}
                  alt="Live feed"
                  className="w-full h-full object-contain"
                />
                <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/60 px-2 py-1 rounded">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-[10px] text-red-400 font-medium">LIVE</span>
                </div>
              </>
            ) : (
              <div className="text-center">
                <div className="w-3 h-3 rounded-full bg-gray-600 mx-auto mb-2" />
                <p className="text-xs text-gray-600">Camera offline</p>
              </div>
            )}
          </div>
        </div>
      );
    }
    setSelectedOp(null);
  }

  // Grid view
  return (
    <div className="p-3 space-y-3 overflow-auto">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-gray-500 uppercase tracking-wide">
          Operator Feeds
        </p>
        <div className="flex items-center gap-2">
          {liveCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-red-400">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              {liveCount} live
            </span>
          )}
          <span className="text-[10px] text-gray-600">
            {visibleFeeds.length} connected
          </span>
          {allFeeds.some((f) => !f.isLive) && (
            <button
              onClick={() => {
                const inactive = allFeeds.filter((f) => !f.isLive).map((f) => f.id);
                setHiddenOps((prev) => {
                  const next = new Set(prev);
                  inactive.forEach((id) => next.add(id));
                  return next;
                });
                setFrames((prev) => {
                  const next = new Map(prev);
                  inactive.forEach((id) => next.delete(id));
                  return next;
                });
              }}
              className="text-[10px] text-gray-600 hover:text-gray-300 px-1.5 py-0.5 rounded border border-gray-700 hover:border-gray-500 transition-colors"
            >
              Clear inactive
            </button>
          )}
        </div>
      </div>

      <div className={`grid gap-2 ${visibleFeeds.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
        {visibleFeeds.map((feed, i) => {
          const color = OPERATOR_COLORS[i % OPERATOR_COLORS.length];
          return (
            <button
              key={feed.id}
              onClick={() => setSelectedOp(feed.id)}
              className="bg-gray-800/60 border border-gray-700/50 rounded-lg overflow-hidden text-left hover:border-gray-600 transition-colors"
            >
              <div className="relative aspect-video bg-gray-900">
                {feed.isLive && feed.frame ? (
                  <>
                    <img
                      src={feed.frame.frame}
                      alt={`${feed.name} feed`}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute top-1.5 left-1.5 flex items-center gap-1 bg-black/60 px-1.5 py-0.5 rounded">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-[8px] text-red-400 font-medium">LIVE</span>
                    </div>
                  </>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center">
                    <div className="w-2.5 h-2.5 rounded-full bg-gray-700 mb-1" />
                    <p className="text-[9px] text-gray-700">Camera off</p>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="text-[10px] font-medium text-gray-300 flex-1 truncate">
                  {feed.name}
                </span>
                {feed.zone && (
                  <span className="text-[9px] text-blue-400 truncate">
                    {feed.zone.label}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

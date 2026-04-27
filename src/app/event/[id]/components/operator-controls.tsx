"use client";

import { useState } from "react";
import type { Zone, SpatialSnapshot } from "@/lib/types";

export function OperatorControls({
  eventId,
  zones,
  spatial,
}: {
  eventId: string;
  zones: Zone[];
  spatial: SpatialSnapshot;
}) {
  const [rawText, setRawText] = useState("");
  const [selectedZone, setSelectedZone] = useState(zones[0]?.id || "");
  const [sending, setSending] = useState(false);
  const [lastParse, setLastParse] = useState<string | null>(null);

  async function handleInspection() {
    if (!rawText.trim()) return;
    setSending(true);
    setLastParse(null);
    try {
      const res = await fetch("/api/inspection/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: eventId, raw_text: rawText }),
      });
      const data = await res.json();
      if (data.accepted) {
        setLastParse(`Matched: ${data.parsed.note} (confidence: ${Math.round(data.parsed.confidence * 100)}%)`);
        setRawText("");
      } else {
        setLastParse(`Not accepted: ${data.reason}`);
      }
    } finally {
      setSending(false);
    }
  }

  async function handleEnterZone() {
    if (!selectedZone) return;
    await fetch("/api/spatial/enter-zone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: eventId, zone_id: selectedZone }),
    });
  }

  async function handleExitZone() {
    if (!spatial.current_zone) return;
    await fetch("/api/spatial/exit-zone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_id: eventId,
        zone_id: spatial.current_zone,
      }),
    });
  }

  async function handleVerdict() {
    await fetch(`/api/event/${eventId}/verdict`, { method: "POST" });
  }

  const currentZone = zones.find((z) => z.id === spatial.current_zone);

  return (
    <div className="bg-gray-900 rounded-lg p-4 space-y-4">
      <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
        Operator Controls
      </h2>

      {/* Inspection Input */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">
          Inspection Note (Bodhi Input)
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleInspection()}
            placeholder='e.g., "WiFi is working great"'
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-600"
            disabled={sending}
          />
          <button
            onClick={handleInspection}
            disabled={sending || !rawText.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white text-sm px-4 py-2 rounded"
          >
            {sending ? "..." : "Send"}
          </button>
        </div>
        {lastParse && (
          <p className="text-xs text-gray-500 mt-1">{lastParse}</p>
        )}
      </div>

      {/* Zone Controls (Meta Glasses Simulated) */}
      <div>
        <label className="block text-xs text-gray-500 mb-1">
          Zone Navigation (Meta Glasses Simulated)
        </label>
        {currentZone && (
          <p className="text-xs text-blue-400 mb-2">
            Currently in: {currentZone.label}
          </p>
        )}
        <div className="flex gap-2">
          <select
            value={selectedZone}
            onChange={(e) => setSelectedZone(e.target.value)}
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white"
            disabled={!!spatial.current_zone}
          >
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.label}
              </option>
            ))}
          </select>
          {!spatial.current_zone ? (
            <button
              onClick={handleEnterZone}
              className="bg-green-700 hover:bg-green-600 text-white text-sm px-4 py-2 rounded"
            >
              Enter Zone
            </button>
          ) : (
            <button
              onClick={handleExitZone}
              className="bg-orange-700 hover:bg-orange-600 text-white text-sm px-4 py-2 rounded"
            >
              Exit Zone
            </button>
          )}
        </div>
      </div>

      {/* Verdict */}
      <button
        onClick={handleVerdict}
        className="w-full bg-purple-700 hover:bg-purple-600 text-white font-medium py-2 rounded text-sm"
      >
        Request Final Verdict
      </button>
    </div>
  );
}

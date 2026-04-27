"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const [name, setName] = useState("HackSF 2026 — Main Hall");
  const [roomName, setRoomName] = useState("Main Hall");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const router = useRouter();

  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/event/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, room_name: roomName }),
      });
      const data = await res.json();
      if (data.session?.id) {
        setSessionId(data.session.id);
      } else {
        setError(JSON.stringify(data));
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  const [copied, setCopied] = useState(false);

  const shareUrl = sessionId
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/event/${sessionId}`
    : "";

  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // After session created, show role picker
  if (sessionId) {
    return (
      <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="w-full max-w-md p-8">
          <h1 className="text-2xl font-bold mb-1">Session Ready</h1>
          <p className="text-gray-500 text-sm mb-6">{name}</p>

          {/* Shareable link for operators */}
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 mb-6">
            <p className="text-xs text-gray-400 mb-2">
              Share this link with operators — phones auto-join as operators:
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={shareUrl}
                readOnly
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white font-mono text-[11px] truncate"
              />
              <button
                onClick={copyLink}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-2 rounded font-medium shrink-0"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="text-[10px] text-gray-600 mt-2">
              Mobile devices are automatically redirected to the operator view
            </p>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => router.push(`/event/${sessionId}`)}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-4 rounded-lg transition-colors text-left px-4"
            >
              <p className="font-semibold">Open Command Center</p>
              <p className="text-xs text-blue-200 mt-0.5">
                Full dashboard — map, feeds, activity, avatar
              </p>
            </button>
          </div>

          <p className="text-[10px] text-gray-600 mt-4 text-center">
            Session ID: {sessionId}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
      <div className="w-full max-w-md p-8">
        <h1 className="text-3xl font-bold mb-2">TrialRun</h1>
        <p className="text-gray-400 mb-8">
          Real-time room readiness verification
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Event Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Room Name
            </label>
            <input
              type="text"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white"
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={loading || !name || !roomName}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white font-medium py-3 rounded-lg transition-colors"
          >
            {loading ? "Creating..." : "Start Inspection"}
          </button>
          {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
        </div>
      </div>
    </main>
  );
}

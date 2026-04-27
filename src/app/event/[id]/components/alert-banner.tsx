import type { SpatialRealAlert } from "@/lib/types";
import { useEffect } from "react";

export function AlertBanner({
  alert,
  onDismiss,
}: {
  alert: SpatialRealAlert;
  onDismiss: () => void;
}) {
  // Auto-dismiss after 8 seconds
  useEffect(() => {
    const timer = setTimeout(onDismiss, 8000);
    return () => clearTimeout(timer);
  }, [alert.id, onDismiss]);

  // Speak the alert via browser TTS (SpatialReal placeholder)
  useEffect(() => {
    if ("speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(alert.message);
      utterance.rate = 0.9;
      utterance.pitch = 1.0;
      speechSynthesis.speak(utterance);
    }
  }, [alert.id, alert.message]);

  const isCritical = alert.severity === "critical";

  return (
    <div
      className={`mx-4 mt-2 p-4 rounded-lg flex items-start justify-between ${
        isCritical
          ? "bg-red-900/50 border border-red-700"
          : "bg-yellow-900/50 border border-yellow-700"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl">{isCritical ? "🔴" : "⚠️"}</span>
        <div>
          <p className="text-xs text-gray-400 uppercase mb-1">
            {alert.type} — {alert.severity}
          </p>
          <p className="text-sm text-white">{alert.message}</p>
        </div>
      </div>
      <button
        onClick={onDismiss}
        className="text-gray-500 hover:text-gray-300 text-sm ml-4"
      >
        ✕
      </button>
    </div>
  );
}

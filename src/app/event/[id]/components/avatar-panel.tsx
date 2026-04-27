"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { SpatialRealAlert } from "@/lib/types";

// PCM audio utilities
function float32ToPcm16(float32: Float32Array): ArrayBuffer {
  const pcm16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    pcm16[i] = s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0;
  }
  return pcm16.buffer;
}

const CHUNK_SIZE = 32000;
const CHUNK_INTERVAL = 80;

function sendPcmChunks(
  data: ArrayBuffer,
  send: (chunk: ArrayBuffer, end: boolean) => void,
  onDone?: () => void
): () => void {
  const bytes = new Uint8Array(data);
  let offset = 0;
  let cancelled = false;
  const next = () => {
    if (cancelled) return;
    if (offset >= bytes.length) {
      send(new ArrayBuffer(0), true);
      onDone?.();
      return;
    }
    const end = Math.min(offset + CHUNK_SIZE, bytes.length);
    send(bytes.slice(offset, end).buffer, false);
    offset = end;
    setTimeout(next, CHUNK_INTERVAL);
  };
  next();
  return () => { cancelled = true; };
}

function textToPcm16(text: string): ArrayBuffer {
  const sampleRate = 16000;
  const duration = Math.max(2, text.length * 0.06);
  const samples = Math.floor(sampleRate * duration);
  const float32 = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const envelope =
      Math.sin((t / duration) * Math.PI) *
      (0.05 + 0.03 * Math.sin(t * 8 * Math.PI));
    float32[i] = envelope * (Math.random() * 0.4 - 0.2);
  }
  return float32ToPcm16(float32);
}

interface AvatarPanelProps {
  alert: SpatialRealAlert | null;
  onAlertPlayed?: () => void;
}

// Track SDK init globally to prevent double-init in React Strict Mode
let sdkInitialized = false;

export function AvatarPanel({ alert, onAlertPlayed }: AvatarPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<unknown>(null);
  const viewRef = useRef<unknown>(null);
  const [phase, setPhase] = useState<"init" | "loaded" | "ready" | "connected" | "error">("init");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const alertQueueRef = useRef<SpatialRealAlert[]>([]);
  const processingRef = useRef(false);

  const appId = process.env.NEXT_PUBLIC_SPATIALREAL_APP_ID;
  const avatarId = process.env.NEXT_PUBLIC_SPATIALREAL_AVATAR_ID;

  // Step 1: Load avatar model only (no WebSocket connection)
  useEffect(() => {
    if (!appId || !avatarId) {
      setErrorMsg("SpatialReal credentials not configured — using TTS fallback");
      setPhase("error");
      return;
    }

    let disposed = false;

    const loadAvatar = async () => {
      try {
        const sdk = await import("@spatialwalk/avatarkit");
        const { AvatarSDK, AvatarManager, AvatarView, Environment, DrivingServiceMode } = sdk;

        if (disposed) return;

        // Initialize SDK only once globally
        if (!sdkInitialized) {
          await AvatarSDK.initialize(appId, {
            environment: Environment.intl,
            drivingServiceMode: DrivingServiceMode.sdk,
            audioFormat: { channelCount: 1, sampleRate: 16000 },
          });
          sdkInitialized = true;
        }

        // Fetch and set session token
        const tokenRes = await fetch("/api/spatialreal/token", { method: "POST" });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok || !tokenData.sessionToken) {
          throw new Error(tokenData.error || "Failed to get session token");
        }
        AvatarSDK.setSessionToken(tokenData.sessionToken);

        if (disposed || !containerRef.current) return;

        setPhase("loaded");

        // Load avatar model (downloads + caches assets)
        const avatar = await AvatarManager.shared.load(avatarId, (info: { progress?: number }) => {
          setLoadProgress(info.progress ?? 0);
        });

        if (disposed || !containerRef.current) return;

        // Create view — renders the 3D avatar but does NOT connect WebSocket
        const view = new AvatarView(avatar, containerRef.current);
        viewRef.current = view;
        controllerRef.current = view.controller;

        // Register callbacks (won't fire until start() is called)
        view.controller.onConnectionState = (state: string) => {
          if (state === "connected") setPhase("connected");
          if (state === "disconnected" || state === "failed") setPhase("ready");
        };
        view.controller.onConversationState = (state: string) => {
          setSpeaking(state === "playing");
        };
        view.controller.onError = (err: Error) => {
          console.warn("[SpatialReal]", err.message);
        };

        setPhase("ready");
      } catch (err) {
        if (!disposed) {
          setErrorMsg(`${err instanceof Error ? err.message : String(err)} — using TTS fallback`);
          setPhase("error");
        }
      }
    };

    loadAvatar();

    return () => {
      disposed = true;
      const view = viewRef.current as { controller: { close: () => void }; dispose: () => void } | null;
      if (view) {
        try { view.controller.close(); view.dispose(); } catch { /* ignore */ }
        viewRef.current = null;
        controllerRef.current = null;
      }
    };
  }, [appId, avatarId]);

  // Step 2: Connect avatar (user gesture required for audio context)
  const handleConnect = useCallback(async () => {
    const controller = controllerRef.current as {
      initializeAudioContext?: () => Promise<void>;
      start?: () => Promise<void>;
    } | null;
    if (!controller) return;

    try {
      // Audio context MUST be created inside a user gesture handler
      await controller.initializeAudioContext?.();
      // Now open WebSocket to SpatialReal driving service
      await controller.start?.();
    } catch (err) {
      setErrorMsg(`Connection failed: ${err instanceof Error ? err.message : String(err)}`);
      setPhase("error");
    }
  }, []);

  // Speak an alert
  const speakAlert = useCallback(
    async (alertToSpeak: SpatialRealAlert) => {
      // Browser TTS for audio
      if ("speechSynthesis" in window) {
        const utterance = new SpeechSynthesisUtterance(alertToSpeak.message);
        utterance.rate = 0.9;
        speechSynthesis.speak(utterance);
      }

      // If avatar connected, send PCM for lip-sync
      const controller = controllerRef.current as {
        send?: (data: ArrayBuffer, end: boolean) => void;
      } | null;

      if (controller?.send && phase === "connected") {
        try {
          const pcm = textToPcm16(alertToSpeak.message);
          sendPcmChunks(
            pcm,
            (chunk, end) => controller.send!(chunk, end),
            () => { setSpeaking(false); onAlertPlayed?.(); }
          );
          setSpeaking(true);
          return;
        } catch { /* fall through to TTS-only */ }
      }

      // TTS-only: wait for it to finish
      setSpeaking(true);
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (!speechSynthesis.speaking) { clearInterval(check); resolve(); }
        }, 200);
        setTimeout(() => { clearInterval(check); resolve(); }, 15000);
      });
      setSpeaking(false);
      onAlertPlayed?.();
    },
    [phase, onAlertPlayed]
  );

  // Process alert queue
  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    while (alertQueueRef.current.length > 0) {
      const next = alertQueueRef.current.shift()!;
      await speakAlert(next);
      await new Promise((r) => setTimeout(r, 500));
    }
    processingRef.current = false;
  }, [speakAlert]);

  useEffect(() => {
    if (alert) {
      alertQueueRef.current.push(alert);
      processQueue();
    }
  }, [alert, processQueue]);

  const isCritical = alert?.severity === "critical";

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
          Alert Avatar
        </h2>
        <span
          className={`w-2.5 h-2.5 rounded-full ${
            speaking
              ? "bg-red-400 animate-pulse"
              : phase === "connected"
                ? "bg-green-500"
                : phase === "ready"
                  ? "bg-yellow-500"
                  : "bg-gray-600"
          }`}
        />
      </div>

      {/* Avatar container — AvatarView renders WebGL here */}
      <div
        ref={containerRef}
        className="w-full aspect-square bg-gray-800 rounded-lg overflow-hidden flex items-center justify-center"
      >
        {phase === "init" && (
          <p className="text-xs text-gray-600">Initializing SDK...</p>
        )}
        {phase === "loaded" && (
          <p className="text-xs text-gray-600">
            Loading avatar {Math.round(loadProgress)}%...
          </p>
        )}
        {phase === "error" && (
          <div className="text-center p-4">
            <div className="text-4xl mb-2">{speaking ? "\uD83D\uDDE3" : "\uD83E\uDDD1"}</div>
            <p className="text-[10px] text-gray-600">{errorMsg}</p>
          </div>
        )}
      </div>

      {/* Connect button — requires user gesture for AudioContext */}
      {phase === "ready" && (
        <button
          onClick={handleConnect}
          className="w-full mt-2 bg-purple-700 hover:bg-purple-600 text-white text-xs py-1.5 rounded"
        >
          Connect Avatar
        </button>
      )}

      {/* Alert display */}
      {alert && speaking && (
        <div
          className={`mt-2 p-2 rounded text-xs ${
            isCritical
              ? "bg-red-900/50 text-red-300"
              : "bg-yellow-900/50 text-yellow-300"
          }`}
        >
          {alert.message}
        </div>
      )}

      {/* Status */}
      <div className="mt-2 flex gap-2 text-[10px] text-gray-600">
        <span>{phase}</span>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import type {
  EventSession,
  Zone,
  ChecklistItem,
  Task,
  SpatialSnapshot,
  SpatialRealAlert,
  Readiness,
} from "@/lib/types";

type Tab = "camera" | "checklist" | "tasks";

interface EventState {
  session: EventSession;
  zones: Zone[];
  items: ChecklistItem[];
  tasks: Task[];
  spatial: SpatialSnapshot;
  alerts: SpatialRealAlert[];
}

interface AnalysisResult {
  zone_entered: string | null;
  items_verified: string[];
  issues: string[];
  scene: string;
}

// ── Readiness badge colors ──
const readinessConfig: Record<Readiness, { bg: string; label: string }> = {
  READY: { bg: "bg-green-600", label: "READY" },
  PARTIAL: { bg: "bg-yellow-600", label: "PARTIAL" },
  BLOCKED: { bg: "bg-red-600", label: "BLOCKED" },
  UNKNOWN: { bg: "bg-gray-600", label: "UNKNOWN" },
};

// Generate a stable device ID for this browser
function getDeviceId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = localStorage.getItem("trialrun_device_id");
  if (!id) {
    id = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem("trialrun_device_id", id);
  }
  return id;
}

export function OperatorMobile({ eventId }: { eventId: string }) {
  const [state, setState] = useState<EventState | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("camera");
  const [alert, setAlert] = useState<SpatialRealAlert | null>(null);
  const [operatorId, setOperatorId] = useState<string | null>(null);
  const [operatorName, setOperatorName] = useState<string>("");
  const [totalOperators, setTotalOperators] = useState(1);

  // Voice state
  const [voiceConnected, setVoiceConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextPlayTimeRef = useRef(0);

  // Camera state
  const [cameraMode, setCameraMode] = useState<"idle" | "live" | "analyzing" | "result">("idle");
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const broadcastIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const feedChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const operatorIdRef = useRef<string | null>(null);
  const operatorNameRef = useRef<string>("");

  // ── Register operator on mount ──
  useEffect(() => {
    const register = async () => {
      const deviceId = getDeviceId();
      try {
        const res = await fetch("/api/operators/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event_id: eventId, device_id: deviceId }),
        });
        const data = await res.json();
        if (data.operator) {
          setOperatorId(data.operator.id);
          setOperatorName(data.operator.name);
          operatorIdRef.current = data.operator.id;
          operatorNameRef.current = data.operator.name;
          setTotalOperators(data.total_operators);
        }
      } catch { /* ignore registration errors */ }
    };
    register();
  }, [eventId]);

  // ── Fetch state ──
  const fetchState = useCallback(async () => {
    const res = await fetch(`/api/event/${eventId}`);
    const data = await res.json();
    setState(data);
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    fetchState();
    const poll = setInterval(fetchState, 3000);
    return () => clearInterval(poll);
  }, [fetchState]);

  // ── Realtime ──
  useEffect(() => {
    const channel = supabase
      .channel(`op:${eventId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "checklist_items", filter: `event_id=eq.${eventId}` }, () => fetchState())
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `event_id=eq.${eventId}` }, () => fetchState())
      .on("postgres_changes", { event: "*", schema: "public", table: "event_sessions", filter: `id=eq.${eventId}` }, () => fetchState())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "alerts", filter: `event_id=eq.${eventId}` }, (payload) => {
        const a = payload.new as SpatialRealAlert;
        setAlert(a);
        // Speak alert
        if ("speechSynthesis" in window) {
          speechSynthesis.speak(new SpeechSynthesisUtterance(a.message));
        }
        // Vibrate
        if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
        fetchState();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "user_path_events", filter: `event_id=eq.${eventId}` }, () => fetchState())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [eventId, fetchState]);

  // ── Voice (Bodhi) ──
  function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
    if (fromRate === toRate) return input;
    const ratio = fromRate / toRate;
    const len = Math.floor(input.length / ratio);
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) { const p = i * ratio; const idx = Math.floor(p); out[i] = input[idx] * (1 - (p - idx)) + (input[idx + 1] || 0) * (p - idx); }
    return out;
  }

  const connectVoice = useCallback(async () => {
    audioCtxRef.current = new AudioContext();
    const bodhiUrl = process.env.NEXT_PUBLIC_BODHI_WS_URL;
    const wsUrl = bodhiUrl
      ? bodhiUrl
      : window.location.hostname === "localhost"
        ? "ws://localhost:9900"
        : `wss://${window.location.hostname}:9900`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    ws.onopen = async () => {
      setVoiceConnected(true);
      ws.send(JSON.stringify({ type: "text_input", text: `My event session ID is ${eventId}` }));

      // Start mic
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      micStreamRef.current = stream;
      const ctx = audioCtxRef.current!;
      if (ctx.state === "suspended") await ctx.resume();
      const source = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(2048, 1, 1);
      proc.onaudioprocess = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const raw = e.inputBuffer.getChannelData(0);
        const down = downsample(raw, ctx.sampleRate, 16000);
        const i16 = new Int16Array(down.length);
        for (let i = 0; i < down.length; i++) { const s = Math.max(-1, Math.min(1, down[i])); i16[i] = s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0; }
        ws.send(i16.buffer);
      };
      source.connect(proc);
      const silence = ctx.createGain(); silence.gain.value = 0;
      proc.connect(silence); silence.connect(ctx.destination);
      processorRef.current = proc;
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        const ctx = audioCtxRef.current; if (!ctx) return;
        if (ctx.state === "suspended") ctx.resume();
        const view = new DataView(event.data);
        const len = event.data.byteLength / 2;
        const f32 = new Float32Array(len);
        for (let i = 0; i < len; i++) f32[i] = view.getInt16(i * 2, true) / 32768;
        if (f32.length === 0) return;
        try {
          const buf = ctx.createBuffer(1, f32.length, 24000);
          buf.getChannelData(0).set(f32);
          const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
          const now = ctx.currentTime;
          if (nextPlayTimeRef.current < now) nextPlayTimeRef.current = now + 0.05;
          src.start(nextPlayTimeRef.current);
          nextPlayTimeRef.current += buf.duration;
        } catch { /* ignore */ }
      }
    };

    ws.onclose = () => { setVoiceConnected(false); };
    wsRef.current = ws;
  }, [eventId]);

  const disconnectVoice = useCallback(() => {
    wsRef.current?.close(); wsRef.current = null;
    processorRef.current?.disconnect(); processorRef.current = null;
    micStreamRef.current?.getTracks().forEach(t => t.stop()); micStreamRef.current = null;
    setVoiceConnected(false);
  }, []);

  // ── Camera ──
  const analyzeImage = useCallback(async (base64: string, mimeType: string) => {
    // Keep camera live during analysis — don't change mode away from "live"
    const wasLive = cameraMode === "live";
    if (!wasLive) setCameraMode("analyzing");
    try {
      const res = await fetch("/api/vision/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: eventId, image_base64: base64, mime_type: mimeType, operator_id: operatorId }),
      });
      const data = await res.json();
      if (data.results) {
        setAnalysisResult(data.results);
        if (!wasLive) setCameraMode("result");
        // If was live, stay in live mode — result shows as overlay
      } else if (!wasLive) {
        setCameraMode("idle");
      }
    } catch {
      if (!wasLive) setCameraMode("idle");
    }
  }, [eventId, cameraMode, operatorId]);

  const startCamera = useCallback(async () => {
    try {
      // On mobile Safari, request camera permission with simpler constraints first
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch {
        // Fallback: try without facing mode constraint
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      streamRef.current = stream;
      setAnalysisResult(null);
      setPreview(null);
      setCameraMode("live");
    } catch (err) {
      console.error("Camera error:", err);
      window.alert("Camera access denied. Please allow camera permissions and try again.");
    }
  }, []);

  // Attach stream to video element AFTER it renders + start broadcasting frames
  useEffect(() => {
    if (cameraMode === "live" && streamRef.current && videoRef.current) {
      const video = videoRef.current;
      video.srcObject = streamRef.current;
      video.muted = true;
      video.setAttribute("playsinline", "true");
      video.setAttribute("webkit-playsinline", "true");
      video.play().catch(() => {});

      // Start broadcasting frames to command center
      const broadcastCanvas = document.createElement("canvas");
      broadcastCanvas.width = 320;
      broadcastCanvas.height = 240;
      const bCtx = broadcastCanvas.getContext("2d");

      const startBroadcasting = () => {
        console.log("[Operator] Starting broadcast on feed:" + eventId);
        broadcastIntervalRef.current = setInterval(() => {
          if (!bCtx || !video.videoWidth || !feedChannelRef.current) return;
          bCtx.drawImage(video, 0, 0, 320, 240);
          const dataUrl = broadcastCanvas.toDataURL("image/jpeg", 0.4);
          feedChannelRef.current.send({
            type: "broadcast",
            event: "frame",
            payload: {
              operator_id: operatorIdRef.current || "unknown",
              operator_name: operatorNameRef.current || "Operator",
              frame: dataUrl,
              zone_id: null,
              timestamp: Date.now(),
            },
          });
        }, 500); // ~2 FPS
      };

      if (!feedChannelRef.current) {
        console.log("[Operator] Creating channel feed:" + eventId);
        feedChannelRef.current = supabase.channel(`feed:${eventId}`);
        feedChannelRef.current.subscribe((status: string) => {
          console.log("[Operator] Channel status:", status);
          if (status === "SUBSCRIBED") startBroadcasting();
        });
      } else {
        startBroadcasting();
      }
    }

    return () => {
      if (broadcastIntervalRef.current) {
        clearInterval(broadcastIntervalRef.current);
        broadcastIntervalRef.current = null;
      }
    };
  }, [cameraMode, eventId]);

  const capture = useCallback(async () => {
    const v = videoRef.current, c = canvasRef.current;
    if (!v || !c) return;
    if (!v.videoWidth || !v.videoHeight) return;
    setCapturing(true);
    try {
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext("2d")!.drawImage(v, 0, 0);
      const url = c.toDataURL("image/jpeg", 0.8);
      setPreview(url);
      await analyzeImage(url.split(",")[1], "image/jpeg");
    } finally {
      setCapturing(false);
    }
  }, [analyzeImage]);

  const handleGallery = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const url = reader.result as string;
      setPreview(url);
      await analyzeImage(url.split(",")[1], file.type);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [analyzeImage]);

  // Cleanup
  useEffect(() => {
    return () => {
      disconnectVoice();
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (broadcastIntervalRef.current) clearInterval(broadcastIntervalRef.current);
      if (feedChannelRef.current) supabase.removeChannel(feedChannelRef.current);
    };
  }, [disconnectVoice]);

  if (loading || !state) {
    return <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center"><p className="text-gray-400">Loading...</p></div>;
  }

  const r = readinessConfig[state.session.readiness];
  const verified = state.items.filter(i => i.status === "verified").length;
  const total = state.items.length;
  const myOpenTasks = state.tasks.filter(t => t.status === "open" && (operatorId ? t.assigned_to === operatorId : true)).length;
  const openTasks = myOpenTasks;
  const currentZone = state.zones.find(z => z.id === state.spatial.current_zone);

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* ── Header ── */}
      <header className="px-4 py-3 border-b border-gray-800 flex items-center justify-between shrink-0">
        <div className="min-w-0">
          <h1 className="text-sm font-bold truncate">{state.session.name}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            {currentZone && <span className="text-[10px] text-blue-400">{currentZone.label}</span>}
            <span className="text-[10px] text-gray-500">{verified}/{total}</span>
          </div>
        </div>
        <span className={`${r.bg} text-white text-xs px-3 py-1 rounded font-bold`}>{r.label}</span>
      </header>

      {/* ── Alert toast ── */}
      {alert && (
        <div className={`mx-3 mt-2 p-3 rounded-lg flex items-start gap-2 ${alert.severity === "critical" ? "bg-red-900/60 border border-red-700" : "bg-yellow-900/60 border border-yellow-700"}`}>
          <span className="text-lg shrink-0">{alert.severity === "critical" ? "🔴" : "⚠️"}</span>
          <p className="text-xs text-white flex-1">{alert.message}</p>
          <button onClick={() => setAlert(null)} className="text-gray-500 text-sm">✕</button>
        </div>
      )}

      {/* ── Voice bar ── */}
      <div className="px-3 py-2 border-b border-gray-800 shrink-0">
        <button
          onClick={voiceConnected ? disconnectVoice : connectVoice}
          className={`w-full py-3 rounded-lg text-sm font-medium flex items-center justify-center gap-2 ${
            voiceConnected ? "bg-red-700 hover:bg-red-600" : "bg-green-700 hover:bg-green-600"
          } text-white`}
        >
          {voiceConnected ? (
            <><span className="w-2.5 h-2.5 rounded-full bg-red-300 animate-pulse" />Stop Voice</>
          ) : (
            <><span className="text-lg">🎙</span>Start Voice Inspector</>
          )}
        </button>
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-auto">
        {tab === "camera" && (
          <div className="p-3">
            {/* Viewfinder */}
            <div className="w-full aspect-[4/3] bg-gray-800 rounded-xl overflow-hidden relative mb-3">
              {cameraMode === "live" && (
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  autoPlay
                  playsInline
                  muted
                  style={{ minHeight: "200px", background: "#000" }}
                />
              )}
              {(cameraMode === "analyzing" || cameraMode === "result") && preview && <img src={preview} alt="" className="w-full h-full object-cover" />}
              {cameraMode === "analyzing" && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {cameraMode === "idle" && (
                <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5">
                    <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  <p className="text-xs text-gray-600">Point and scan</p>
                </div>
              )}
            </div>
            <canvas ref={canvasRef} className="hidden" />
            <input ref={galleryRef} type="file" accept="image/*" onChange={handleGallery} className="hidden" />

            {/* Camera buttons */}
            {cameraMode === "idle" && (
              <div className="space-y-2">
                <button onClick={startCamera} className="w-full bg-blue-700 hover:bg-blue-600 text-white py-3 rounded-xl text-sm font-medium">
                  Open Camera
                </button>
                <button onClick={() => galleryRef.current?.click()} className="w-full bg-indigo-700 hover:bg-indigo-600 text-white py-3 rounded-xl text-sm font-medium">
                  Pick Glasses Photo
                </button>
              </div>
            )}
            {cameraMode === "live" && (
              <div className="space-y-2">
                <button onClick={capture} disabled={capturing} className={`w-full ${capturing ? "bg-yellow-600" : "bg-green-600 hover:bg-green-500"} text-white py-4 rounded-xl text-base font-bold flex items-center justify-center gap-2`}>
                  {capturing ? (
                    <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />Analyzing...</>
                  ) : "Capture + Analyze"}
                </button>
                <button
                  onClick={() => {
                    streamRef.current?.getTracks().forEach(t => t.stop());
                    setCameraMode("idle");
                    setAnalysisResult(null);
                    setPreview(null);
                  }}
                  className="w-full bg-gray-700 text-white py-2 rounded-xl text-xs"
                >
                  Stop Camera
                </button>
              </div>
            )}
            {cameraMode === "result" && (
              <button onClick={() => { setCameraMode("idle"); setPreview(null); setAnalysisResult(null); }} className="w-full bg-gray-700 text-white py-3 rounded-xl text-sm">
                Scan Another
              </button>
            )}

            {/* Results — show for both live (overlay) and result modes */}
            {analysisResult && (cameraMode === "result" || cameraMode === "live") && (
              <div className="mt-3 space-y-2">
                <p className="text-xs text-gray-400">{analysisResult.scene}</p>
                {analysisResult.zone_entered && (
                  <div className="bg-blue-900/30 border border-blue-800 rounded-lg px-3 py-2 text-xs text-blue-300">
                    → Zone detected: {analysisResult.zone_entered}
                  </div>
                )}
                {analysisResult.items_verified.map((item, i) => (
                  <div key={i} className="bg-green-900/30 border border-green-800 rounded-lg px-3 py-2 text-xs text-green-300">
                    ✓ {item}
                  </div>
                ))}
                {analysisResult.issues.map((issue, i) => (
                  <div key={i} className="bg-red-900/30 border border-red-800 rounded-lg px-3 py-2 text-xs text-red-300">
                    ! {issue}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "checklist" && (
          <div className="p-3 space-y-1">
            {state.zones.map(zone => {
              const zoneItems = state.items.filter(i => i.zone_id === zone.id);
              const zv = zoneItems.filter(i => i.status === "verified").length;
              return (
                <div key={zone.id} className="mb-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] text-gray-500 uppercase">{zone.label}</p>
                    <p className="text-[10px] text-gray-600">{zv}/{zoneItems.length}</p>
                  </div>
                  {zoneItems.map(item => (
                    <div key={item.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-1 ${
                      item.status === "verified" ? "bg-green-900/20 border border-green-800/30" :
                      item.status === "flagged" ? "bg-red-900/20 border border-red-800/30" :
                      "bg-gray-800/50 border border-gray-700/30"
                    }`}>
                      <span className={`text-sm ${item.status === "verified" ? "text-green-400" : item.status === "flagged" ? "text-red-400" : "text-gray-600"}`}>
                        {item.status === "verified" ? "✓" : item.status === "flagged" ? "✗" : "○"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-200">{item.label}</p>
                        {item.note && <p className="text-[10px] text-gray-500 truncate">{item.note}</p>}
                      </div>
                      {item.criticality === "critical" && <span className="text-[9px] text-red-400">CRIT</span>}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {tab === "tasks" && (() => {
          // Filter: show tasks assigned to this operator, or unassigned tasks if no operator ID yet
          const myTasks = state.tasks.filter(t =>
            t.status === "open" &&
            (operatorId ? (t as Task & { assigned_to?: string }).assigned_to === operatorId : true)
          );
          const otherTasks = state.tasks.filter(t =>
            t.status === "open" &&
            operatorId &&
            (t as Task & { assigned_to?: string }).assigned_to !== operatorId &&
            (t as Task & { assigned_to?: string }).assigned_to !== null
          );
          return (
            <div className="p-3 space-y-2">
              {/* Operator info */}
              {operatorId && (
                <div className="flex items-center justify-between text-[10px] text-gray-500 pb-2 border-b border-gray-800">
                  <span>{operatorName} — {myTasks.length} assigned to you</span>
                  <span>{totalOperators} operator{totalOperators > 1 ? "s" : ""} active</span>
                </div>
              )}

              {myTasks.length === 0 && (
                <p className="text-sm text-gray-600 text-center py-8">No tasks assigned to you</p>
              )}
              {myTasks.map(task => (
                <div key={task.id} className={`p-3 rounded-lg border ${
                  task.type === "contradiction" ? "bg-red-900/20 border-red-800/30" :
                  "bg-yellow-900/20 border-yellow-800/30"
                }`}>
                  <p className="text-[10px] text-gray-500 uppercase mb-1">{task.type.replace("_", " ")}</p>
                  <p className="text-sm text-gray-200 mb-1">{task.title}</p>
                  <p className="text-[10px] text-gray-500 mb-2">{task.description}</p>
                  <button
                    onClick={async () => {
                      await fetch("/api/tasks/update", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ task_id: task.id, status: "resolved" }),
                      });
                    }}
                    className="bg-gray-700 text-white text-xs px-3 py-1.5 rounded"
                  >
                    Resolve
                  </button>
                </div>
              ))}

              {/* Other operators' tasks (collapsed) */}
              {otherTasks.length > 0 && (
                <div className="pt-2 border-t border-gray-800">
                  <p className="text-[10px] text-gray-600">{otherTasks.length} task{otherTasks.length > 1 ? "s" : ""} assigned to other operators</p>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* ── Bottom tab bar ── */}
      <nav className="flex border-t border-gray-800 shrink-0 bg-gray-900 safe-bottom">
        {([
          { key: "camera" as Tab, icon: "📷", label: "Scan" },
          { key: "checklist" as Tab, icon: "☑", label: "Checklist" },
          { key: "tasks" as Tab, icon: "📋", label: "Tasks", badge: openTasks || undefined },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-3 flex flex-col items-center gap-0.5 text-xs ${
              tab === t.key ? "text-blue-400" : "text-gray-500"
            }`}
          >
            <span className="text-lg">{t.icon}</span>
            <span>{t.label}</span>
            {t.badge && (
              <span className="absolute -mt-1 ml-4 bg-red-600 text-white text-[8px] w-4 h-4 rounded-full flex items-center justify-center">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}

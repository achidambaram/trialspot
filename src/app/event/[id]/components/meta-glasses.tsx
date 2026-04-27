"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface MetaGlassesProps {
  eventId: string;
}

interface AnalysisResult {
  zone_entered: string | null;
  items_verified: string[];
  issues: string[];
  scene: string;
}

export function MetaGlasses({ eventId }: MetaGlassesProps) {
  const [mode, setMode] = useState<"idle" | "camera" | "analyzing" | "result">("idle");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [history, setHistory] = useState<{ scene: string; verified: number; issues: number }[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Shared analyze function
  const analyzeImage = useCallback(async (base64: string, mimeType: string) => {
    setMode("analyzing");
    setError(null);

    try {
      const res = await fetch("/api/vision/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: eventId,
          image_base64: base64,
          mime_type: mimeType,
        }),
      });
      const data = await res.json();

      if (data.error) {
        setError(data.error);
        setMode("idle");
        return;
      }

      const r = data.results as AnalysisResult;
      setResult(r);
      setMode("result");
      setHistory(prev => [...prev, {
        scene: r.scene,
        verified: r.items_verified.length,
        issues: r.issues.length,
      }]);
    } catch (err) {
      setError(String(err));
      setMode("idle");
    }
  }, [eventId]);

  // === INPUT MODE 1: Phone camera (fallback) ===
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: 1280, height: 720 },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setMode("camera");
      setError(null);
      setResult(null);
      setPreview(null);
    } catch (err) {
      setError(`Camera access denied: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const captureAndAnalyze = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    const base64 = dataUrl.split(",")[1];
    setPreview(dataUrl);
    stopCamera();

    await analyzeImage(base64, "image/jpeg");
  }, [analyzeImage, stopCamera]);

  // === INPUT MODE 2: Gallery pick (Meta glasses photos) ===
  const handleGalleryPick = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1];
        setPreview(dataUrl);
        await analyzeImage(base64, file.type || "image/jpeg");
      };
      reader.readAsDataURL(file);
      // Reset so same file can be selected again
      e.target.value = "";
    },
    [analyzeImage]
  );

  // === INPUT MODE 3: File upload ===
  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1];
        setPreview(dataUrl);
        await analyzeImage(base64, file.type || "image/jpeg");
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    },
    [analyzeImage]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => { stopCamera(); };
  }, [stopCamera]);

  const reset = useCallback(() => {
    setMode("idle");
    setResult(null);
    setPreview(null);
    setError(null);
  }, []);

  return (
    <div className="p-4">
      {/* Viewfinder / Preview */}
      <div className="w-full aspect-video bg-gray-800 rounded-lg overflow-hidden relative mb-3">
        {mode === "camera" && (
          <video ref={videoRef} className="w-full h-full object-cover" autoPlay playsInline muted />
        )}
        {(mode === "analyzing" || mode === "result") && preview && (
          <img src={preview} alt="Captured" className="w-full h-full object-cover" />
        )}
        {mode === "analyzing" && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="text-center">
              <div className="w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-1" />
              <p className="text-[10px] text-blue-300">Gemini analyzing...</p>
            </div>
          </div>
        )}
        {mode === "idle" && (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4b5563" strokeWidth="1.5">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <circle cx="12" cy="10" r="3" />
              <path d="M2 20h20" strokeDasharray="2,2" />
            </svg>
            <p className="text-[10px] text-gray-600">Meta Glasses / Phone Camera</p>
          </div>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {/* Hidden file inputs */}
      <input ref={galleryInputRef} type="file" accept="image/*" onChange={handleGalleryPick} className="hidden" />
      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} className="hidden" capture="environment" />

      {/* Controls */}
      {mode === "idle" && (
        <div className="space-y-2">
          {/* Primary: Meta Glasses photo (from gallery) */}
          <button
            onClick={() => galleryInputRef.current?.click()}
            className="w-full bg-indigo-700 hover:bg-indigo-600 text-white text-xs py-2.5 rounded font-medium flex items-center justify-center gap-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            Pick Glasses Photo
          </button>
          <p className="text-[9px] text-gray-600 text-center -mt-1">
            &quot;Hey Meta, take a photo&quot; → pick from gallery
          </p>

          {/* Secondary: Phone camera */}
          <div className="flex gap-2">
            <button
              onClick={startCamera}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-xs py-2 rounded flex items-center justify-center gap-1"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              Phone Camera
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-xs py-2 rounded flex items-center justify-center gap-1"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
              </svg>
              Upload
            </button>
          </div>
        </div>
      )}

      {mode === "camera" && (
        <div className="flex gap-2">
          <button onClick={captureAndAnalyze} className="flex-1 bg-green-700 hover:bg-green-600 text-white text-xs py-2 rounded font-medium">
            Capture + Analyze
          </button>
          <button onClick={() => { stopCamera(); setMode("idle"); }} className="bg-gray-700 text-white text-xs py-2 px-3 rounded">
            Cancel
          </button>
        </div>
      )}

      {mode === "result" && (
        <button onClick={reset} className="w-full bg-gray-700 hover:bg-gray-600 text-white text-xs py-2 rounded">
          Scan Another
        </button>
      )}

      {/* Results */}
      {result && mode === "result" && (
        <div className="mt-2 space-y-1.5">
          <p className="text-[10px] text-gray-400">{result.scene}</p>
          {result.zone_entered && (
            <div className="flex items-center gap-1.5 text-[10px] bg-blue-900/30 border border-blue-800 rounded px-2 py-1">
              <span className="text-blue-400">→</span>
              <span className="text-blue-300">Zone: {result.zone_entered}</span>
            </div>
          )}
          {result.items_verified.map((item, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[10px] bg-green-900/30 border border-green-800 rounded px-2 py-1">
              <span className="text-green-400">✓</span>
              <span className="text-green-300">{item}</span>
            </div>
          ))}
          {result.issues.map((issue, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[10px] bg-red-900/30 border border-red-800 rounded px-2 py-1">
              <span className="text-red-400">!</span>
              <span className="text-red-300">{issue}</span>
            </div>
          ))}
          {result.items_verified.length === 0 && result.issues.length === 0 && !result.zone_entered && (
            <p className="text-[10px] text-gray-500">No checklist items detected.</p>
          )}
        </div>
      )}

      {/* Scan history */}
      {history.length > 0 && mode !== "result" && (
        <div className="mt-3 pt-2 border-t border-gray-800">
          <p className="text-[9px] text-gray-600 mb-1">{history.length} scan{history.length > 1 ? "s" : ""} this session</p>
          <div className="flex gap-3 text-[10px]">
            <span className="text-green-500">{history.reduce((s, h) => s + h.verified, 0)} verified</span>
            <span className="text-red-500">{history.reduce((s, h) => s + h.issues, 0)} issues</span>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-[10px] text-red-400">{error}</p>}
    </div>
  );
}

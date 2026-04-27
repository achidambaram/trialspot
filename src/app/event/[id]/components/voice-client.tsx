"use client";

import { useState, useRef, useCallback, useEffect } from "react";

const INPUT_RATE = 16000;
const CAPTURE_BUF = 2048;
const OUTPUT_RATE = 24000;

function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const len = Math.floor(input.length / ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    out[i] = input[idx] * (1 - frac) + (input[idx + 1] || 0) * frac;
  }
  return out;
}

function float32ToInt16(f32: Float32Array): Int16Array {
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    i16[i] = s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0;
  }
  return i16;
}

function int16ToFloat32(buf: ArrayBuffer): Float32Array {
  const view = new DataView(buf);
  const len = buf.byteLength / 2;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = view.getInt16(i * 2, true) / 32768;
  }
  return out;
}

export function VoiceClient({ eventId }: { eventId: string }) {
  const [connected, setConnected] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [transcript, setTranscript] = useState<string[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextPlayTimeRef = useRef(0);

  const playChunk = useCallback((arrayBuf: ArrayBuffer) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();

    const f32 = int16ToFloat32(arrayBuf);
    if (f32.length === 0) return;

    try {
      const audioBuf = ctx.createBuffer(1, f32.length, OUTPUT_RATE);
      audioBuf.getChannelData(0).set(f32);
      const src = ctx.createBufferSource();
      src.buffer = audioBuf;
      src.connect(ctx.destination);

      const now = ctx.currentTime;
      if (nextPlayTimeRef.current < now) {
        nextPlayTimeRef.current = now + 0.05;
      }
      src.start(nextPlayTimeRef.current);
      nextPlayTimeRef.current += audioBuf.duration;
    } catch {
      // ignore playback errors
    }
  }, []);

  const startMic = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    micStreamRef.current = stream;

    let ctx = audioCtxRef.current;
    if (!ctx || ctx.state === "closed") {
      ctx = new AudioContext();
      audioCtxRef.current = ctx;
    }
    if (ctx.state === "suspended") await ctx.resume();

    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(CAPTURE_BUF, 1, 1);

    processor.onaudioprocess = (e) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const raw = e.inputBuffer.getChannelData(0);
      const down = downsample(raw, ctx!.sampleRate, INPUT_RATE);
      const pcm = float32ToInt16(down);
      ws.send(pcm.buffer);
    };

    source.connect(processor);
    const silence = ctx.createGain();
    silence.gain.value = 0;
    processor.connect(silence);
    silence.connect(ctx.destination);
    processorRef.current = processor;
    setMicActive(true);
  }, []);

  const stopMic = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    setMicActive(false);
  }, []);

  const connect = useCallback(async () => {
    // Create audio context on user gesture
    audioCtxRef.current = new AudioContext();

    // Use env var, or auto-detect: if on HTTPS (tunnel), use the Bodhi tunnel URL
    // Otherwise fall back to local WebSocket
    const bodhiUrl = process.env.NEXT_PUBLIC_BODHI_WS_URL;
    const wsUrl = bodhiUrl
      ? bodhiUrl
      : window.location.hostname === "localhost"
        ? "ws://localhost:9900"
        : `wss://${window.location.hostname}:9900`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    ws.onopen = async () => {
      setConnected(true);
      // Send event ID to Bodhi so it knows which session to use
      ws.send(
        JSON.stringify({
          type: "text_input",
          text: `My event session ID is ${eventId}`,
        })
      );
      try {
        await startMic();
      } catch (err) {
        console.error("Mic error:", err);
        ws.close();
      }
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        playChunk(event.data);
      } else {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "transcript" && msg.text) {
            setTranscript((prev) => {
              const entry = `${msg.role === "user" ? "You" : "Bodhi"}: ${msg.text}`;
              return [...prev.slice(-19), entry];
            });
          }
        } catch {
          // ignore
        }
      }
    };

    ws.onclose = () => {
      setConnected(false);
      stopMic();
    };

    ws.onerror = () => {
      console.error("WebSocket error");
    };

    wsRef.current = ws;
  }, [eventId, startMic, stopMic, playChunk]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    stopMic();
    setConnected(false);
  }, [stopMic]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      stopMic();
      audioCtxRef.current?.close();
    };
  }, [stopMic]);

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
          Voice Inspector (Bodhi)
        </h2>
        <span
          className={`text-xs px-2 py-0.5 rounded ${
            connected
              ? "bg-green-900 text-green-400"
              : "bg-gray-800 text-gray-500"
          }`}
        >
          {connected ? (micActive ? "Listening" : "Connected") : "Disconnected"}
        </span>
      </div>

      {!connected ? (
        <button
          onClick={connect}
          className="w-full bg-green-700 hover:bg-green-600 text-white font-medium py-3 rounded text-sm flex items-center justify-center gap-2"
        >
          <span className="text-lg">🎙</span>
          Start Voice Inspection
        </button>
      ) : (
        <button
          onClick={disconnect}
          className="w-full bg-red-700 hover:bg-red-600 text-white font-medium py-3 rounded text-sm"
        >
          Stop Voice
        </button>
      )}

      {/* Live transcript */}
      {transcript.length > 0 && (
        <div className="mt-3 max-h-40 overflow-auto space-y-1">
          {transcript.map((line, i) => (
            <p
              key={i}
              className={`text-xs ${
                line.startsWith("You:")
                  ? "text-blue-400"
                  : "text-green-400"
              }`}
            >
              {line}
            </p>
          ))}
        </div>
      )}

      {connected && (
        <p className="text-[10px] text-gray-600 mt-2">
          Speak naturally. Say things like &quot;WiFi is working&quot; or
          &quot;I&apos;m at the stage now&quot;.
        </p>
      )}
    </div>
  );
}

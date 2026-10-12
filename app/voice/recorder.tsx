"use client";
import { useI18n } from "../i18n/provider";


import { useEffect, useRef, useState } from "react";

type RecorderState = "idle" | "recording" | "paused" | "ready";
const SAFE_AUDIO_BYTES = 10 * 1024 * 1024 - 64 * 1024;

function recordingFormat() {
  const choices = [
    { mime: "audio/mp4", extension: "m4a" },
    { mime: "audio/webm;codecs=opus", extension: "webm" },
    { mime: "audio/webm", extension: "webm" },
    { mime: "audio/ogg;codecs=opus", extension: "ogg" },
  ];
  return choices.find(choice => MediaRecorder.isTypeSupported(choice.mime)) || { mime: "", extension: "webm" };
}

function clock(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function VoiceRecorder({ disabled, onReady }: { disabled: boolean; onReady: (file: File) => void }) {
  const { tr } = useI18n();
  const [state, setState] = useState<RecorderState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const bytesRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  function releaseMicrophone() {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }

  useEffect(() => () => {
    stopTimer();
    if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
    releaseMicrophone();
  }, []);

  useEffect(() => {
    if (state !== "recording") return;
    timerRef.current = setInterval(() => setSeconds(value => value + 1), 1000);
    return stopTimer;
  }, [state]);

  useEffect(() => {
    if (state !== "recording" && state !== "paused") return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state]);

  async function start() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser cannot record audio here. Choose an audio file instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const format = recordingFormat();
      // Keep speech recordings compact without changing their duration.
      const recorder = format.mime ? new MediaRecorder(stream, { mimeType: format.mime, audioBitsPerSecond: 24000 }) : new MediaRecorder(stream, { audioBitsPerSecond: 24000 });
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      bytesRef.current = 0;
      setSeconds(0);
      recorder.ondataavailable = event => {
        if (!event.data.size) return;
        chunksRef.current.push(event.data);
        bytesRef.current += event.data.size;
        if (bytesRef.current >= SAFE_AUDIO_BYTES && recorder.state !== "inactive") {
          setError("Recording approached the 10 MB limit and stopped automatically. You can play it back or download a copy before uploading.");
          stopTimer();
          recorder.stop();
        }
      };
      recorder.onerror = () => {
        setError("Recording stopped unexpectedly. Keep the page open and try again.");
        setState("idle");
        releaseMicrophone();
      };
      recorder.onstop = () => {
        const mime = recorder.mimeType || format.mime || "audio/webm";
        const extension = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
        const blob = new Blob(chunksRef.current, { type: mime });
        releaseMicrophone();
        if (!blob.size) {
          setError("No audio was captured. Check microphone permission and try again.");
          setState("idle");
          return;
        }
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        onReady(new File([blob], `voice-note-${stamp}.${extension}`, { type: mime, lastModified: Date.now() }));
        setState("ready");
      };
      recorder.start(1000);
      setState("recording");
    } catch (cause) {
      const denied = cause instanceof DOMException && (cause.name === "NotAllowedError" || cause.name === "SecurityError");
      setError(denied ? "Microphone access was blocked. Allow it in your browser settings, then try again." : "Could not start the microphone. Choose an audio file instead.");
      releaseMicrophone();
    }
  }

  function pause() {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.pause();
      setState("paused");
    }
  }

  function resume() {
    if (recorderRef.current?.state === "paused") {
      recorderRef.current.resume();
      setState("recording");
    }
  }

  function stop() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    stopTimer();
  }

  return <div className="voice-recorder">
    <div className="voice-recorder-status" aria-live="polite">
      <span className={`recording-dot ${state === "recording" ? "is-live" : ""}`} aria-hidden="true" />
      <strong>{tr(state === "recording" ? "Recording" : state === "paused" ? "Paused" : state === "ready" ? "Added to queue" : "Record here")}</strong>
      {(state === "recording" || state === "paused" || state === "ready") && <time>{tr(clock(seconds))}</time>}
    </div>
    <div className="voice-buttons">
      {(state === "idle" || state === "ready") && <button className="voice-record-button" disabled={disabled} onClick={() => void start()}>{tr(state === "ready" ? "Record another" : "Start recording")}</button>}
      {state === "recording" && <button disabled={disabled} onClick={pause}>{tr("Pause")}</button>}
      {state === "paused" && <button disabled={disabled} onClick={resume}>{tr("Resume")}</button>}
      {(state === "recording" || state === "paused") && <button className="voice-stop-button" onClick={stop}>{tr("Stop")}</button>}
    </div>
    {error && <p role="alert" className="voice-warning">{tr(error)}</p>}
    <p className="voice-muted">{tr("Each finished recording is added to the queue below. Keep this tab open until you process or download the queued audio.")}</p>
  </div>;
}

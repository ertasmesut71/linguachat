import { useState, useRef, useCallback, useEffect } from "react";

/**
 * Hook for recording audio using the MediaRecorder API.
 * Returns { isRecording, duration, start, stop, cancel, audioBlob, audioBase64 }
 */
export function useVoiceRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioBase64, setAudioBase64] = useState(null);
  const [error, setError] = useState(null);

  const mediaRecorder = useRef(null);
  const stream = useRef(null);
  const chunks = useRef([]);
  const timerRef = useRef(null);
  const startTimeRef = useRef(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stream.current) {
      stream.current.getTracks().forEach((t) => t.stop());
      stream.current = null;
    }
    mediaRecorder.current = null;
    chunks.current = [];
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setAudioBlob(null);
    setAudioBase64(null);
    setDuration(0);
    chunks.current = [];

    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100,
        },
      });

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "audio/webm";

      mediaRecorder.current = new MediaRecorder(stream.current, { mimeType });

      mediaRecorder.current.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };

      mediaRecorder.current.onstop = async () => {
        const blob = new Blob(chunks.current, { type: mimeType });
        setAudioBlob(blob);

        // Convert to base64
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result.split(",")[1];
          setAudioBase64(base64);
        };
        reader.readAsDataURL(blob);
      };

      mediaRecorder.current.start(250); // collect chunks every 250ms
      startTimeRef.current = Date.now();
      setIsRecording(true);

      timerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 200);
    } catch (err) {
      setError(err.message || "Microphone access denied");
      cleanup();
    }
  }, [cleanup]);

  const stop = useCallback(() => {
    if (mediaRecorder.current && mediaRecorder.current.state !== "inactive") {
      mediaRecorder.current.stop();
    }
    setIsRecording(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (stream.current) {
      stream.current.getTracks().forEach((t) => t.stop());
      stream.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    stop();
    setAudioBlob(null);
    setAudioBase64(null);
    setDuration(0);
    chunks.current = [];
  }, [stop]);

  const reset = useCallback(() => {
    setAudioBlob(null);
    setAudioBase64(null);
    setDuration(0);
    setError(null);
  }, []);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  return {
    isRecording,
    duration,
    audioBlob,
    audioBase64,
    error,
    mimeType: mediaRecorder.current?.mimeType || "audio/webm",
    start,
    stop,
    cancel,
    reset,
  };
}

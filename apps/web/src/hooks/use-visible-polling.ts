"use client";

import { useEffect, useRef } from "react";

type PollReason = "start" | "interval" | "visibility" | "focus";

type VisiblePollingOptions = {
  enabled?: boolean;
  forceOnForeground?: boolean;
  intervalMs: number;
  onPoll: (signal: AbortSignal, reason: PollReason) => void | Promise<void>;
};

export function useVisiblePolling({
  enabled = true,
  forceOnForeground = false,
  intervalMs,
  onPoll,
}: VisiblePollingOptions) {
  const onPollRef = useRef(onPoll);
  onPollRef.current = onPoll;

  useEffect(() => {
    if (!enabled) return;

    let timer: number | null = null;
    let activeRequest: AbortController | null = null;

    function stop() {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      activeRequest?.abort();
      activeRequest = null;
    }

    function poll(reason: PollReason) {
      if (document.visibilityState !== "visible") return;
      if (activeRequest) {
        const shouldReplace = forceOnForeground && (reason === "focus" || reason === "visibility");
        if (!shouldReplace) return;
        activeRequest.abort();
      }

      const request = new AbortController();
      activeRequest = request;
      void Promise.resolve()
        .then(() => onPollRef.current(request.signal, reason))
        .finally(() => {
          if (activeRequest === request) activeRequest = null;
        });
    }

    function start() {
      if (document.visibilityState !== "visible" || timer !== null) return;
      poll("start");
      timer = window.setInterval(() => poll("interval"), intervalMs);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        poll("visibility");
        start();
      } else {
        stop();
      }
    }

    function handleFocus() {
      poll("focus");
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    start();

    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [enabled, forceOnForeground, intervalMs]);
}

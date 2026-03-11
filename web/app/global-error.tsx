"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body style={{ backgroundColor: "#000", color: "#fff", fontFamily: "system-ui", padding: "2rem" }}>
        <h2>Something went wrong</h2>
        <p style={{ color: "#999" }}>We&apos;ve been notified and are looking into it.</p>
        <button
          onClick={reset}
          style={{
            marginTop: "1rem",
            padding: "0.5rem 1rem",
            backgroundColor: "#333",
            color: "#fff",
            border: "1px solid #555",
            borderRadius: "0.5rem",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}

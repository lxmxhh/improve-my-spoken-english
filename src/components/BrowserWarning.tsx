"use client";

import { useEffect, useState } from "react";

export default function BrowserWarning() {
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    const hasSTT =
      typeof window !== "undefined" &&
      ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
    setUnsupported(!hasSTT);
  }, []);

  if (!unsupported) return null;

  return (
    <div className="w-full bg-amber-400 text-amber-900 text-sm text-center py-2 px-4 font-medium">
      Voice features require Chrome or Edge. Please switch browsers to use the
      microphone.
    </div>
  );
}

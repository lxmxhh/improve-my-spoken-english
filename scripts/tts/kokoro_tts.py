#!/usr/bin/env python3
"""Generate a WAV file with the local Kokoro TTS pipeline."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate local Kokoro speech audio.")
    parser.add_argument("--text", default="", help="Text to synthesize.")
    parser.add_argument("--batch-json", help="JSON array of {text, voice, output} items.")
    parser.add_argument("--voice", default="af_heart", help="Kokoro voice name.")
    parser.add_argument("--lang", default="a", help="Kokoro language code, e.g. a for American English.")
    parser.add_argument("--speed", type=float, default=1.0, help="Speech speed.")
    parser.add_argument("--output", default="", help="Output WAV path.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    batch_items = parse_batch_items(args.batch_json)
    text = args.text.strip() if args.text else ""
    if not text and not batch_items:
        print("Missing text", file=sys.stderr)
        return 2

    try:
        import numpy as np
        import soundfile as sf
        from kokoro import KPipeline
    except ImportError as exc:
        print(
            "Missing Kokoro dependencies. Install with: "
            "pip install 'kokoro>=0.9.4' soundfile numpy",
            file=sys.stderr,
        )
        print(str(exc), file=sys.stderr)
        return 3

    output_path = Path(args.output) if args.output else None
    if text and output_path is None:
        print("Missing output", file=sys.stderr)
        return 2

    try:
        pipeline = KPipeline(lang_code=args.lang)
        if batch_items:
            for item in batch_items:
                synthesize_to_file(
                    pipeline=pipeline,
                    text=item["text"],
                    voice=item.get("voice") or args.voice,
                    speed=args.speed,
                    output_path=Path(item["output"]),
                    np=np,
                    sf=sf,
                )
        else:
            synthesize_to_file(
                pipeline=pipeline,
                text=text,
                voice=args.voice,
                speed=args.speed,
                output_path=output_path,
                np=np,
                sf=sf,
            )
        return 0
    except Exception as exc:  # noqa: BLE001 - CLI should surface dependency/model failures.
        print(f"Kokoro generation failed: {exc}", file=sys.stderr)
        return 5


def parse_batch_items(raw: str | None) -> list[dict[str, str]]:
    if not raw:
        return []

    try:
        parsed: Any = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid batch JSON: {exc}") from exc

    if not isinstance(parsed, list):
        raise SystemExit("Batch JSON must be an array")

    items: list[dict[str, str]] = []
    for item in parsed:
        if not isinstance(item, dict):
            raise SystemExit("Each batch item must be an object")
        text = str(item.get("text", "")).strip()
        output = str(item.get("output", "")).strip()
        voice = str(item.get("voice", "")).strip()
        if not text or not output:
            raise SystemExit("Each batch item requires text and output")
        items.append({"text": text, "output": output, "voice": voice})
    return items


def synthesize_to_file(*, pipeline, text: str, voice: str, speed: float, output_path: Path, np, sf) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    chunks = []
    for _, _, audio in pipeline(text, voice=voice, speed=speed):
        chunks.append(np.asarray(audio, dtype=np.float32))

    if not chunks:
        raise RuntimeError("Kokoro generated no audio")

    audio = np.concatenate(chunks)
    sf.write(output_path, audio, 24000)


if __name__ == "__main__":
    raise SystemExit(main())

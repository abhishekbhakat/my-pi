"""Run the pinned Jev browser agent with bounded ticks and JSON output."""

import argparse
import contextlib
import importlib
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--goal", required=True)
    parser.add_argument("--max-ticks", type=int, default=40)
    args = parser.parse_args()
    try:
        url = urlsplit(args.url)
        valid_url = url.scheme in {"http", "https"} and url.hostname and not url.username and not url.password
        url.port
    except ValueError:
        valid_url = False
    if not valid_url:
        parser.error("--url must be an HTTP(S) URL without embedded credentials")
    if not args.goal.strip():
        parser.error("--goal must not be blank")
    if not 1 <= args.max_ticks <= 100:
        parser.error("--max-ticks must be between 1 and 100")
    return args


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def run_agent(agent_type, args):
    status = "tick_limit"
    ticks = 0
    output = sys.stdout
    # Keep upstream diagnostics separate from machine-readable stdout.
    with contextlib.redirect_stdout(sys.stderr):
        with agent_type(args.url, args.goal) as agent:
            for ticks in range(1, args.max_ticks + 1):
                state = agent.command("tick")
                progress = {
                    "type": "progress", "tick": ticks,
                    "status": state["status"], "elapsed_ms": state["elapsed_ms"],
                    "actions": len(state["history"]),
                }
                with contextlib.redirect_stdout(output):
                    emit(progress)
                if state["status"] in {"done", "blocked"}:
                    status = state["status"]
                    break
            final = agent.snapshot()
    emit({
        "type": "result", "status": status, "verified": False, "ticks": ticks,
        "page": final["page"], "history": final["history"],
        "note": "DONE is an agent claim. Check final page evidence against the goal.",
    })
    return 0 if status == "done" else 2


def load_typesafe_key():
    if os.environ.get("TYPESAFE_API_KEY", "").strip():
        return
    path = Path(__file__).resolve().parent.parent / "typesafe-ai" / "typesafe-auth.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return
    except (OSError, ValueError):
        raise ValueError("Could not load typesafe-ai/typesafe-auth.json") from None
    key = data.get("api_key") if isinstance(data, dict) else None
    if not isinstance(key, str) or not key.strip():
        raise ValueError("typesafe-ai/typesafe-auth.json requires a nonempty api_key")
    os.environ["TYPESAFE_API_KEY"] = key.strip()


def main():
    args = arguments()
    try:
        load_typesafe_key()
    except ValueError as error:
        emit({"type": "error", "error": str(error)})
        return 1
    missing = [name for name in ("TYPESAFE_API_KEY", "TEXT_MODEL_API_KEY") if not os.environ.get(name, "").strip()]
    if missing:
        emit({"type": "error", "error": "Missing environment variables", "missing": missing})
        return 1
    try:
        agent_type = importlib.import_module("jev_ultrafast").Agent
        return run_agent(agent_type, args)
    except Exception as error:
        # Exception messages can contain private URLs or provider response bodies.
        emit({"type": "error", "error": type(error).__name__, "verified": False})
        return 1


if __name__ == "__main__":
    sys.exit(main())

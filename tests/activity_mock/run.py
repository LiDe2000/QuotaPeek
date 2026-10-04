"""Run the real Rust/browser-preview clients against two isolated local FastAPI servers."""

import os
import socket
import subprocess
import sys
import time
import urllib.request
from io import TextIOWrapper
from pathlib import Path

# Node's test reporter emits Unicode even when Windows redirects stdout as GBK.
if isinstance(sys.stdout, TextIOWrapper):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[2]
processes = []
flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def run(args):
    result = subprocess.run(
        args,
        cwd=ROOT,
        creationflags=flags,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    print(result.stdout.decode("utf-8", errors="replace"), end="", flush=True)
    result.check_returncode()


def start(directory, port):
    with socket.socket() as check:
        check.settimeout(0.3)
        if check.connect_ex(("127.0.0.1", port)) == 0:
            raise RuntimeError(
                f"Port {port} is in use. Stop your existing test server first; no process was modified."
            )
    env = os.environ.copy()
    env["ACTIVITY_CATALOG_FILE"] = str(ROOT / "tests/activity_mock/activities.json")
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app:app",
            "--app-dir",
            str(directory),
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--no-access-log",
        ],
        cwd=ROOT,
        env=env,
        creationflags=flags,
        stdout=subprocess.DEVNULL,
    )
    processes.append(process)
    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError(f"Test server {port} exited unexpectedly")
        try:
            with urllib.request.urlopen(
                f"http://127.0.0.1:{port}/health", timeout=0.3
            ) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.1)
    raise RuntimeError(f"Test server {port} did not start")


try:
    run(
        [
            sys.executable,
            "-m",
            "unittest",
            "discover",
            "-s",
            "tests/activity_mock",
            "-p",
            "test_*.py",
        ]
    )
    start(ROOT / "activity-service", 1431)
    start(ROOT / "tests/activity_mock", 1432)
    run(
        [
            "cargo",
            "test",
            "--manifest-path",
            "src-tauri/Cargo.toml",
            "activity_mock_end_to_end",
            "--",
            "--ignored",
            "--nocapture",
        ]
    )
    # Reset only this test double, without restarting Windows' venv launcher process tree.
    with urllib.request.urlopen(
        urllib.request.Request(
            "http://127.0.0.1:1432/testing/reset", data=b"", method="POST"
        ),
        timeout=2,
    ):
        pass
    run(["node", "--test", "tests/activity_mock/browser-client.cjs"])
finally:
    for process in reversed(processes):
        if process.poll() is None:
            if os.name == "nt":
                subprocess.run(
                    ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                    creationflags=flags,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    check=False,
                )
            else:
                process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

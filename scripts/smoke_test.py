#!/usr/bin/env python3
"""Exercise a running platform and export a reproducible demo report."""

import argparse
import json
import os
import time
from pathlib import Path

import httpx


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--output", type=Path, default=Path("runtime/reports"))
    parser.add_argument("--samples", type=int, default=16)
    args = parser.parse_args()
    key = os.getenv("MODEL_OPS_API_KEY")
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    with httpx.Client(base_url=args.url, headers=headers, timeout=30) as client:
        client.get("/api/health").raise_for_status()
        datasets = client.get("/api/datasets")
        datasets.raise_for_status()
        dataset = next((d for d in datasets.json() if d["id"] == "manufacturing-v1"), None)
        if dataset is None:
            raise SystemExit("The bundled manufacturing-v1 dataset is missing.")
        response = client.post(
            "/api/runs",
            json={
                "name": "Reproducible demo smoke test",
                "dataset_id": dataset["id"],
                "model_ids": ["demo-baseline", "demo-noisy"],
                "max_samples": args.samples,
                "concurrency": 2,
            },
        )
        response.raise_for_status()
        run = response.json()
        deadline = time.monotonic() + 120
        while run["status"] in {"queued", "running"}:
            if time.monotonic() > deadline:
                raise SystemExit("Evaluation exceeded 120 seconds; inspect the evaluation page.")
            time.sleep(0.2)
            response = client.get(f"/api/runs/{run['id']}")
            response.raise_for_status()
            run = response.json()
        if run["status"] != "completed":
            raise SystemExit(f"Evaluation ended with status: {run['status']}")
        args.output.mkdir(parents=True, exist_ok=True)
        for fmt, ext in [("markdown", "md"), ("json", "json"), ("csv", "csv")]:
            report = client.get(f"/api/runs/{run['id']}/report", params={"format": fmt})
            report.raise_for_status()
            (args.output / f"demo-report.{ext}").write_bytes(report.content)
        print(
            json.dumps(
                {
                    "status": run["status"],
                    "requests": run["completed"],
                    "simulated": True,
                    "output": str(args.output),
                },
                ensure_ascii=False,
            )
        )


if __name__ == "__main__":
    main()

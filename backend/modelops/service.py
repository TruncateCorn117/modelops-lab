"""Serving orchestration, immutable evaluation snapshots and bounded jobs."""

import asyncio
import hashlib
import json
import logging
import platform
import time
import uuid
from collections import defaultdict
from datetime import UTC, datetime

import psutil
from prometheus_client import CollectorRegistry, Gauge, Histogram
from prometheus_client import Counter as MetricCounter

from . import adapters
from .config import ROOT
from .db import Database
from .evaluation import score_output, summarize_results
from .schemas import DatasetInput, ModelInput

logger = logging.getLogger("modelops")
ACTIVE = {"queued", "running"}


def now():
    return datetime.now(UTC).isoformat(timespec="milliseconds")


def uid(prefix):
    return f"{prefix}_{uuid.uuid4().hex[:16]}"


def request_public(row):
    return {k: v for k, v in row.items() if k not in {"text", "output", "expected", "score", "raw_response"}}


def dataset_public(row):
    return {k: v for k, v in row.items() if k != "rows"}


def demo_models():
    for key, name, fault in [
        ("demo-baseline", "规则基线 · 演示", "none"),
        ("demo-noisy", "扰动基线 · 演示", "noisy"),
    ]:
        yield (
            key,
            ModelInput(
                name=name,
                provider="demo",
                model_name="rule-baseline",
                version="1.0",
                timeout_seconds=2,
                fault_mode=fault,
            ).model_dump(),
        )


class Service:
    def __init__(self, settings):
        self.settings = settings
        self.db = Database(settings.database_path)
        self.tasks = {}
        self.background = []
        self.inflight = asyncio.Semaphore(settings.max_inflight)
        self.registry = CollectorRegistry()
        self.calls = MetricCounter(
            "modelops_inference_requests",
            "Inference attempts",
            ["provider", "status"],
            registry=self.registry,
        )
        self.latency = Histogram(
            "modelops_inference_duration_seconds",
            "Inference latency including provider validation",
            ["provider"],
            buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300),
            registry=self.registry,
        )
        self.memory = Gauge(
            "modelops_api_process_memory_bytes",
            "API process RSS, excludes inference server",
            registry=self.registry,
        )
        self.process = psutil.Process()
        self.process.cpu_percent()
        self.resource = {
            "process_cpu_percent": 0.0,
            "process_memory_mb": 0.0,
            "scope": "api_process",
            "sampled_at": now(),
        }

    def seed(self):
        for run in self.db.all("runs"):
            if run["status"] in ACTIVE:
                run.update(
                    status="interrupted",
                    finished_at=now(),
                    error="Server restarted; completed results are preserved. Start a new run to repeat.",
                )
                self.finish_summary(run)
                self.db.put("runs", run)
        if not self.settings.seed:
            return
        if not self.db.all("models"):
            for key, model in demo_models():
                model.update(
                    id=key,
                    is_default=key == "demo-baseline",
                    created_at=now(),
                    status="unknown",
                    last_checked=None,
                    health_detail="尚未检查",
                )
                self.db.put("models", model)
        path = self.settings.data_path / "manufacturing_tickets.json"
        if path.exists() and not self.db.get("datasets", "manufacturing-v1"):
            value = DatasetInput.model_validate(json.loads(path.read_text()))
            self.add_dataset(value, "manufacturing-v1")

    def add_dataset(self, data, identifier=None):
        value = data.model_dump()
        serialized = json.dumps(value["rows"], ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        value.update(
            id=identifier or uid("ds"),
            sha256=hashlib.sha256(serialized.encode()).hexdigest(),
            count=len(value["rows"]),
            created_at=now(),
        )
        return self.db.put("datasets", value)

    async def start(self):
        if self.settings.public_demo:
            await self.validate_public_demo()
        self.seed()
        if self.settings.public_demo:
            await self.validate_public_demo()
        self.background = [asyncio.create_task(self.health_loop()), asyncio.create_task(self.resource_loop())]

    async def validate_public_demo(self):
        """Fail closed when a private workspace is accidentally used for the public demo.

        Historical runs must be explicitly approved by an offline publisher, contain only
        bundled samples, and use the deterministic demo adapters. No public HTTP endpoint
        can create or approve history.
        """

        def require(condition):
            if not condition:
                raise ValueError(
                    "Public demo database contains unapproved data. Use a fresh, dedicated demo database "
                    "with bundled models/data and explicitly approved synthetic evaluation history."
                )

        models = dict(demo_models())

        def valid_model(model):
            expected = models.get(model.get("id"))
            return expected is not None and all(model.get(k) == v for k, v in expected.items())

        require(all(valid_model(model) for model in self.db.all("models")))
        bundled = DatasetInput.model_validate(
            json.loads((ROOT / "data" / "manufacturing_tickets.json").read_text())
        ).model_dump()
        serialized = json.dumps(bundled["rows"], ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(serialized.encode()).hexdigest()
        for dataset in self.db.all("datasets"):
            require(dataset.get("id") == "manufacturing-v1")
            require(all(dataset.get(k) == v for k, v in bundled.items()))
            require(dataset.get("sha256") == digest)
        samples = {row["id"]: row for row in bundled["rows"]}
        runs = {run["id"]: run for run in self.db.all("runs")}
        for run in runs.values():
            require(run.get("public_demo") is True and run.get("status") == "completed")
            require(run.get("dataset_id") == "manufacturing-v1" and run.get("dataset_sha256") == digest)
            require(bool(run.get("sample_ids")) and set(run["sample_ids"]) <= samples.keys())
            require(bool(run.get("model_ids")) and set(run["model_ids"]) <= models.keys())
            require(bool(run.get("model_snapshots")) and all(valid_model(m) for m in run["model_snapshots"]))
        for row in self.db.all("requests"):
            run = runs.get(row.get("run_id"))
            sample = samples.get(row.get("sample_id"))
            require(run is not None and sample is not None)
            require(row.get("sample_id") in run["sample_ids"] and row.get("model_id") in run["model_ids"])
            require(row.get("text") == sample["text"] and row.get("expected") == sample["expected"])
            require(row.get("provider") == "demo" and row.get("is_simulated") is True)
            require(row.get("status") == "success" and "raw_response" not in row)
            expected = await adapters.infer(models[row["model_id"]], sample["text"])
            require(row.get("output") == expected["output"])

    async def close(self):
        tasks = list(self.tasks.values()) + self.background
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def resource_loop(self):
        while True:
            rss = self.process.memory_info().rss
            self.memory.set(rss)
            self.resource = {
                "process_cpu_percent": self.process.cpu_percent(),
                "process_memory_mb": round(rss / 1024**2, 2),
                "scope": "api_process",
                "sampled_at": now(),
            }
            await asyncio.sleep(3)

    async def health_loop(self):
        while True:
            for model in self.db.all("models"):
                if model["enabled"]:
                    try:
                        await self.health(model["id"])
                    except Exception:
                        logger.warning("health_check_failed model_id=%s", model["id"])
            await asyncio.sleep(self.settings.health_interval)

    async def health(self, model_id):
        snapshot = self.db.get("models", model_id)
        if snapshot is None:
            return None
        result = await adapters.check_health(snapshot)
        current = self.db.get("models", model_id)
        if current is not None:
            # Do not attach stale health to a configuration edited while this check ran.
            if any(current[k] != snapshot[k] for k in ModelInput.model_fields):
                return current
            current.update(status=result["status"], health_detail=result["detail"], last_checked=now())
            self.db.put("models", current)
        return current

    async def invoke(
        self, model, text, *, run_id=None, expected=None, sample_id=None, request_id=None, persist=True
    ):
        identifier = request_id or uid("req")
        started = time.perf_counter()
        row = {
            "id": identifier,
            "model_id": model["id"],
            "model_name": model["name"],
            "model_version": model["version"],
            "provider": model["provider"],
            "run_id": run_id,
            "sample_id": sample_id,
            "text": text,
            "expected": expected,
            "output": None,
            "status": "error",
            "latency_ms": 0,
            "error_code": None,
            "error_message": None,
            "is_simulated": model["provider"] == "demo",
            "input_tokens": None,
            "output_tokens": None,
            "created_at": now(),
            "prompt_version": adapters.PROMPT_VERSION,
        }
        async with self.inflight:
            row["queue_ms"] = round((time.perf_counter() - started) * 1000, 3)
            started = time.perf_counter()
            try:
                result = await asyncio.wait_for(
                    adapters.infer(model, text), timeout=model["timeout_seconds"] + 1
                )
                row.update(
                    {k: result.get(k) for k in ("output", "input_tokens", "output_tokens", "is_simulated")}
                )
                row["status"] = "success"
            except adapters.AdapterError as exc:
                row.update(error_code=exc.code, error_message=exc.message)
            except TimeoutError:
                row.update(error_code="timeout", error_message="Model service exceeded the request deadline")
            except asyncio.CancelledError:
                raise
            except Exception:
                row.update(
                    error_code="internal_error",
                    error_message="Unexpected provider error; inspect server diagnostics",
                )
                logger.error("provider_internal_error request_id=%s", identifier)
        row["latency_ms"] = round((time.perf_counter() - started) * 1000, 3)
        if expected is not None:
            row["score"] = score_output(expected, row["output"] if row["status"] == "success" else None)
        if persist:
            self.db.put("requests", row)
        self.calls.labels(provider=model["provider"], status=row["status"]).inc()
        self.latency.labels(provider=model["provider"]).observe(row["latency_ms"] / 1000)
        logger.info(
            "inference request_id=%s model_id=%s status=%s latency_ms=%s error_code=%s",
            identifier,
            model["id"],
            row["status"],
            row["latency_ms"],
            row["error_code"],
        )
        return row

    def active_runs(self):
        return [r for r in self.db.all("runs") if r["status"] in ACTIVE]

    def busy_model(self, model_id):
        return any(model_id in run["model_ids"] for run in self.active_runs())

    def create_run(self, data, dataset, models):
        rows = [r for r in dataset["rows"] if data.split == "all" or r["split"] == data.split][
            : data.max_samples
        ]
        if not rows:
            raise ValueError("Selected dataset split has no samples")
        run = {
            "id": uid("run"),
            "name": data.name,
            "dataset_id": dataset["id"],
            "dataset_name": dataset["name"],
            "dataset_source": dataset["source"],
            "dataset_revision": dataset["revision"],
            "dataset_sha256": dataset["sha256"],
            "model_ids": [m["id"] for m in models],
            "model_names": [m["name"] for m in models],
            "model_snapshots": models,
            "sample_ids": [r["id"] for r in rows],
            "status": "queued",
            "total": len(rows) * len(models),
            "completed": 0,
            "created_at": now(),
            "started_at": None,
            "finished_at": None,
            "concurrency": data.concurrency,
            "max_samples": data.max_samples,
            "split": data.split,
            "prompt_version": adapters.PROMPT_VERSION,
            "summary": None,
            "by_model": [],
            "model_elapsed_seconds": {},
            "error": None,
            "environment": {
                "python": platform.python_version(),
                "platform": platform.system(),
                "machine": platform.machine(),
                "cpu_count": psutil.cpu_count(),
                "ram_gb": round(psutil.virtual_memory().total / 1024**3, 2),
                "resource_scope": "api_process",
                "warmup": "No automatic warmup; provider state is not reset; loading time is included if incurred",
                "execution": "models run sequentially; configured concurrency within each model",
                "provider_hardware": "Not collected; API host hardware is not necessarily inference host hardware",
            },
        }
        self.db.put("runs", run)
        task = asyncio.create_task(self.execute_run(run, rows))
        self.tasks[run["id"]] = task
        task.add_done_callback(lambda _: self.tasks.pop(run["id"], None))
        return run

    def finish_summary(self, run):
        results = self.db.requests(run_id=run["id"])
        elapsed = 0.0
        if run.get("started_at") and run.get("finished_at"):
            elapsed = max(
                (
                    datetime.fromisoformat(run["finished_at"]) - datetime.fromisoformat(run["started_at"])
                ).total_seconds(),
                0,
            )
        run["completed"] = len(results)
        run["summary"] = summarize_results(results, elapsed)
        run["summary"]["timing_valid"] = run["status"] != "interrupted" and elapsed > 0
        if not run["summary"]["timing_valid"]:
            run["summary"]["throughput_rps"] = None
        run["by_model"] = []
        for model in run["model_snapshots"]:
            selected = [r for r in results if r["model_id"] == model["id"]]
            stats = summarize_results(selected, run["model_elapsed_seconds"].get(model["id"], 0))
            stats["timing_valid"] = (
                run["status"] != "interrupted" and run["model_elapsed_seconds"].get(model["id"], 0) > 0
            )
            if not stats["timing_valid"]:
                stats["throughput_rps"] = None
            run["by_model"].append(
                {
                    "model_id": model["id"],
                    "model_name": model["name"],
                    "is_simulated": model["provider"] == "demo",
                    **stats,
                }
            )

    async def execute_run(self, run, rows):
        run.update(status="running", started_at=now())
        self.db.put("runs", run)
        model_started, current_model = None, None
        try:
            for model in run["model_snapshots"]:
                model_started, current_model = time.perf_counter(), model["id"]
                queue = asyncio.Queue()
                for row in rows:
                    queue.put_nowait(row)

                async def worker():
                    while not queue.empty():
                        item = queue.get_nowait()
                        await self.invoke(
                            model,
                            item["text"],
                            run_id=run["id"],
                            expected=item["expected"],
                            sample_id=item["id"],
                        )
                        run["completed"] += 1
                        self.db.put("runs", run)

                workers = [asyncio.create_task(worker()) for _ in range(min(run["concurrency"], len(rows)))]
                try:
                    await asyncio.gather(*workers)
                finally:
                    for worker_task in workers:
                        if not worker_task.done():
                            worker_task.cancel()
                    await asyncio.gather(*workers, return_exceptions=True)
                run["model_elapsed_seconds"][model["id"]] = time.perf_counter() - model_started
                model_started = None
            run["status"] = "completed"
        except asyncio.CancelledError:
            existing = self.db.get("runs", run["id"])
            run["status"] = "cancelled" if existing and existing["status"] == "cancelled" else "interrupted"
        except Exception:
            run.update(
                status="failed", error="Evaluation runner failed; completed request results are preserved"
            )
            logger.error("evaluation_failed run_id=%s", run["id"])
        finally:
            if model_started is not None:
                run["model_elapsed_seconds"][current_model] = time.perf_counter() - model_started
            run["finished_at"] = now()
            self.finish_summary(run)
            self.db.put("runs", run)

    async def cancel(self, run_id):
        run = self.db.get("runs", run_id)
        if run and run["status"] in ACTIVE:
            run.update(status="cancelled", finished_at=now())
            self.db.put("runs", run)
            task = self.tasks.get(run_id)
            if task:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            run = self.db.get("runs", run_id)
            self.finish_summary(run)
            self.db.put("runs", run)
        return run

    def dashboard(self):
        models = self.db.all("models")
        rows = self.db.requests()
        runs = self.db.all("runs")
        success = [r for r in rows if r["status"] == "success"]
        stats = summarize_results(rows, 0)
        per_model = defaultdict(list)
        daily = defaultdict(lambda: {"requests": 0, "errors": 0})
        for row in rows:
            per_model[row["model_id"]].append(row)
            day = row["created_at"][:10]
            daily[day]["requests"] += 1
            daily[day]["errors"] += row["status"] != "success"
        return {
            "models_total": len(models),
            "models_healthy": sum(m["status"] == "healthy" and m["enabled"] for m in models),
            "requests_total": len(rows),
            "success_rate": len(success) / len(rows) if rows else 0,
            "p95_latency_ms": stats["p95_latency_ms"],
            "runs_total": len(runs),
            "active_runs": sum(r["status"] in ACTIVE for r in runs),
            "resource": self.resource,
            "recent_requests": [request_public(r) for r in rows[:6]],
            "recent_runs": runs[:5],
            "daily": [{"date": day, **daily[day]} for day in sorted(daily)[-14:]],
            "by_model": [
                {
                    "model_id": mid,
                    "model_name": items[0]["model_name"],
                    "requests": len(items),
                    "success_rate": sum(r["status"] == "success" for r in items) / len(items),
                    "avg_latency_ms": sum(r["latency_ms"] for r in items) / len(items),
                }
                for mid, items in per_model.items()
            ],
            "auth_enabled": bool(self.settings.api_key),
        }

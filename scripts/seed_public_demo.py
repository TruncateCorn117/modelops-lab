"""Prepare one synthetic report offline, without enabling public write APIs."""

import asyncio

from modelops.config import Settings
from modelops.schemas import RunInput
from modelops.service import Service


async def main():
    settings = Settings()
    if not settings.public_demo:
        raise SystemExit("Set MODEL_OPS_PUBLIC_DEMO=true and use a dedicated public demo database.")
    service = Service(settings)
    await service.start()
    try:
        if service.db.all("runs"):
            print("Public demo already has a report; no records changed.")
            return
        dataset = service.db.get("datasets", "manufacturing-v1")
        models = [service.db.get("models", name) for name in ("demo-baseline", "demo-noisy")]
        data = RunInput(
            name="公开演示 · 64 条合成工单对比",
            dataset_id="manufacturing-v1",
            model_ids=[model["id"] for model in models],
            split="test",
            max_samples=64,
            concurrency=2,
        )
        run = service.create_run(data, dataset, models)
        run["public_demo"] = True
        service.db.put("runs", run)
        await service.tasks[run["id"]]
        result = service.db.get("runs", run["id"])
        if result["status"] != "completed" or result["completed"] != 128:
            raise RuntimeError("Public demo report did not complete successfully.")
        print(f"Prepared {result['completed']} simulated calls; report {result['id']}.")
    finally:
        await service.close()


if __name__ == "__main__":
    asyncio.run(main())

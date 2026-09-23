"""Explicit, environment-only runtime configuration."""

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def public_demo_enabled() -> bool:
    return os.getenv("MODEL_OPS_PUBLIC_DEMO", "").strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class Settings:
    database_path: Path = field(
        default_factory=lambda: Path(
            os.getenv(
                "MODEL_OPS_DB", "runtime/public-demo.db" if public_demo_enabled() else "runtime/modelops.db"
            )
        )
    )
    data_path: Path = field(default_factory=lambda: Path(os.getenv("MODEL_OPS_DATA", str(ROOT / "data"))))
    frontend_path: Path = field(default_factory=lambda: ROOT / "frontend" / "dist")
    api_key: str = field(default_factory=lambda: os.getenv("MODEL_OPS_API_KEY", ""))
    public_demo: bool = field(default_factory=public_demo_enabled)
    root_path: str = field(default_factory=lambda: os.getenv("MODEL_OPS_ROOT_PATH", "").rstrip("/"))
    health_interval: float = 60.0
    max_inflight: int = 8
    max_active_runs: int = 2
    seed: bool = True

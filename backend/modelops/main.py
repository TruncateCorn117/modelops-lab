"""ModelOps Lab HTTP application. Run with one Uvicorn worker."""

import csv
import hmac
import io
import json
import logging
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.openapi.utils import get_openapi
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import __version__
from .config import Settings
from .evaluation import report_markdown
from .middleware import BodySizeLimitMiddleware, route_path
from .schemas import DatasetInput, InferInput, ModelInput, RunInput
from .service import Service, dataset_public, now, request_public, uid

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


def create_app(settings: Settings | None = None):
    config = settings or Settings()

    @asynccontextmanager
    async def lifespan(application):
        application.state.service = Service(config)
        await application.state.service.start()
        yield
        await application.state.service.close()

    application = FastAPI(
        title="ModelOps Lab",
        version=__version__,
        description="Manufacturing ticket model serving and evaluation. All bundled data is synthetic.",
        lifespan=lifespan,
        root_path=config.root_path,
    )

    application.add_middleware(BodySizeLimitMiddleware)

    def error_response(code, message, status, request_id):
        return JSONResponse(
            {"error": {"code": code, "message": message, "request_id": request_id}}, status_code=status
        )

    @application.middleware("http")
    async def access_policy(request: Request, call_next):
        request.state.request_id = uid("req")
        path = route_path(request.scope)
        protected = (path.startswith("/api/") and path != "/api/health") or path == "/metrics"
        if (
            config.public_demo
            and protected
            and request.method not in {"GET", "HEAD", "OPTIONS"}
            and not (request.method == "POST" and path == "/api/infer")
        ):
            return error_response(
                "public_demo_read_only",
                "Public demo configuration and evaluation history are read-only",
                403,
                request.state.request_id,
            )
        if protected and config.api_key:
            supplied = request.headers.get("authorization", "")
            if not hmac.compare_digest(
                supplied.encode("utf-8"), ("Bearer " + config.api_key).encode("utf-8")
            ):
                return error_response(
                    "unauthorized", "A valid API access key is required", 401, request.state.request_id
                )
        if protected and request.method not in {"GET", "HEAD", "OPTIONS"}:
            origin = request.headers.get("origin")
            trusted = {
                f"{request.url.scheme}://{request.url.netloc}",
                "http://localhost:5173",
                "http://127.0.0.1:5173",
            }
            if origin and origin not in trusted:
                return error_response(
                    "origin_rejected", "Cross-origin mutations are not allowed", 403, request.state.request_id
                )
            try:
                length = int(request.headers.get("content-length", "0"))
            except ValueError:
                length = 0
            if length > 12 * 1024 * 1024:
                return error_response(
                    "payload_too_large", "Request body exceeds 12 MB", 413, request.state.request_id
                )
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        if path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @application.exception_handler(StarletteHTTPException)
    async def http_error(request, exc):
        detail = exc.detail
        if isinstance(detail, dict):
            return error_response(
                detail.get("code", "request_error"),
                detail.get("message", "Request failed"),
                exc.status_code,
                request.state.request_id,
            )
        return error_response(
            "not_found" if exc.status_code == 404 else "request_error",
            str(detail),
            exc.status_code,
            request.state.request_id,
        )

    @application.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # Never echo submitted values: they can contain credentials or private ticket text.
        messages = [".".join(str(x) for x in e["loc"]) + ": " + e["msg"] for e in exc.errors()[:8]]
        return error_response("validation_error", "; ".join(messages), 422, request.state.request_id)

    def svc():
        return application.state.service

    def require(table, identifier):
        value = svc().db.get(table, identifier)
        if value is None:
            raise HTTPException(404, f"{table.rstrip('s')} not found")
        return value

    def editable(model_id):
        if svc().busy_model(model_id):
            raise HTTPException(
                409,
                {
                    "code": "model_busy",
                    "message": "Wait for or cancel active evaluations before changing this model",
                },
            )

    @application.get("/api/health")
    async def health():
        return {
            "status": "ok",
            "version": __version__,
            "auth_required": bool(config.api_key),
            "public_demo": config.public_demo,
        }

    @application.get("/api/models")
    async def list_models():
        return svc().db.all("models")

    @application.post("/api/models", status_code=201)
    async def add_model(data: ModelInput):
        model = data.model_dump()
        model.update(
            id=uid("mdl"),
            created_at=now(),
            is_default=not svc().db.all("models") and data.enabled,
            status="unknown",
            last_checked=None,
            health_detail="尚未检查",
        )
        return svc().db.put("models", model)

    @application.put("/api/models/{model_id}")
    async def update_model(model_id: str, data: ModelInput):
        previous = require("models", model_id)
        editable(model_id)
        previous.update(
            data.model_dump(), status="unknown", last_checked=None, health_detail="配置已更新，等待检查"
        )
        if not previous["enabled"]:
            previous["is_default"] = False
        return svc().db.put("models", previous)

    @application.delete("/api/models/{model_id}", status_code=204)
    async def delete_model(model_id: str):
        require("models", model_id)
        editable(model_id)
        svc().db.delete("models", model_id)
        return Response(status_code=204)

    @application.post("/api/models/{model_id}/default")
    async def default_model(model_id: str):
        model = require("models", model_id)
        if not model["enabled"]:
            raise HTTPException(409, "Enable the model before selecting it as default")
        svc().db.set_default(model_id)
        return require("models", model_id)

    @application.post("/api/models/{model_id}/health")
    async def check_model(model_id: str):
        require("models", model_id)
        return await svc().health(model_id)

    @application.post("/api/infer")
    async def infer_ticket(data: InferInput, request: Request):
        model_id = data.model_id
        if model_id is None:
            model = next((m for m in svc().db.all("models") if m["is_default"] and m["enabled"]), None)
            if model is None:
                raise HTTPException(409, "Select an enabled model or configure a default model")
        else:
            model = require("models", model_id)
        if not model["enabled"]:
            raise HTTPException(409, "Model is disabled")
        if config.public_demo and (
            model["provider"] != "demo" or model.get("fault_mode", "none") not in {"none", "noisy"}
        ):
            raise HTTPException(
                403,
                {"code": "public_demo_provider", "message": "Public demo supports only bundled demo models"},
            )
        if svc().inflight.locked():
            raise HTTPException(
                429,
                {
                    "code": "capacity_exceeded",
                    "message": "All inference slots are busy. Try again after current requests complete",
                },
            )
        result = await svc().invoke(
            model, data.text, request_id=request.state.request_id, persist=not config.public_demo
        )
        if result["status"] != "success":
            status = {"timeout": 504, "configuration_error": 400, "connection_error": 503}.get(
                result["error_code"], 502
            )
            raise HTTPException(status, {"code": result["error_code"], "message": result["error_message"]})
        return {
            k: result[k]
            for k in (
                "id",
                "model_id",
                "model_name",
                "output",
                "latency_ms",
                "input_tokens",
                "output_tokens",
                "is_simulated",
                "created_at",
            )
        }

    @application.get("/api/datasets")
    async def list_datasets():
        return [dataset_public(d) for d in svc().db.all("datasets")]

    @application.post("/api/datasets", status_code=201)
    async def add_dataset(data: DatasetInput):
        return dataset_public(svc().add_dataset(data))

    @application.get("/api/datasets/{dataset_id}")
    async def get_dataset(dataset_id: str):
        return require("datasets", dataset_id)

    @application.get("/api/datasets/{dataset_id}/export")
    async def export_dataset(dataset_id: str):
        dataset = require("datasets", dataset_id)
        value = {k: dataset[k] for k in ("name", "description", "source", "revision", "rows")}
        return Response(
            json.dumps(value, ensure_ascii=False, indent=2),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{dataset_id}.json"'},
        )

    @application.get("/api/runs")
    async def list_runs():
        return svc().db.all("runs")

    @application.post("/api/runs", status_code=202)
    async def start_run(data: RunInput):
        if len(svc().active_runs()) >= config.max_active_runs:
            raise HTTPException(
                429, {"code": "run_capacity_exceeded", "message": "At most two evaluations can run at a time"}
            )
        dataset = require("datasets", data.dataset_id)
        models = [require("models", mid) for mid in data.model_ids]
        if any(not m["enabled"] for m in models):
            raise HTTPException(409, "All selected models must be enabled")
        if any(svc().busy_model(m["id"]) for m in models):
            raise HTTPException(
                409, {"code": "model_busy", "message": "A selected model is already under evaluation"}
            )
        try:
            return svc().create_run(data, dataset, models)
        except ValueError as exc:
            raise HTTPException(422, {"code": "validation_error", "message": str(exc)}) from None

    @application.get("/api/runs/{run_id}")
    async def get_run(run_id: str):
        return require("runs", run_id)

    @application.post("/api/runs/{run_id}/cancel")
    async def cancel_run(run_id: str):
        require("runs", run_id)
        return await svc().cancel(run_id)

    @application.get("/api/runs/{run_id}/results")
    async def run_results(run_id: str):
        require("runs", run_id)
        return svc().db.requests(run_id=run_id)

    @application.get("/api/runs/{run_id}/report")
    async def run_report(run_id: str, format: Literal["markdown", "json", "csv"] = "markdown"):
        run = require("runs", run_id)
        results = svc().db.requests(run_id=run_id)
        if format == "markdown":
            content, mime, extension = report_markdown(run, results), "text/markdown", "md"
        elif format == "json":
            content, mime, extension = (
                json.dumps({"run": run, "results": results}, ensure_ascii=False, indent=2),
                "application/json",
                "json",
            )
        else:
            output = io.StringIO()
            fields = [
                "id",
                "model_id",
                "model_name",
                "sample_id",
                "status",
                "latency_ms",
                "error_code",
                "field_accuracy",
                "category_correct",
                "expected",
                "output",
            ]
            writer = csv.DictWriter(output, fieldnames=fields)
            writer.writeheader()
            for row in results:
                cells = {k: row.get(k, "") for k in fields}
                cells.update(
                    {k: row.get("score", {}).get(k, "") for k in ("field_accuracy", "category_correct")}
                )
                cells["expected"] = json.dumps(row.get("expected"), ensure_ascii=False)
                cells["output"] = json.dumps(row.get("output"), ensure_ascii=False)
                # Prevent spreadsheet formula execution from user-supplied names.
                for key, value in cells.items():
                    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")):
                        cells[key] = "'" + value
                writer.writerow(cells)
            content, mime, extension = "\ufeff" + output.getvalue(), "text/csv", "csv"
        return Response(
            content,
            media_type=mime,
            headers={"Content-Disposition": f'attachment; filename="{run_id}.{extension}"'},
        )

    @application.get("/api/requests")
    async def requests(
        limit: int = Query(default=100, ge=1, le=1000),
        model_id: str | None = None,
        status: Literal["success", "error"] | None = None,
    ):
        return [request_public(r) for r in svc().db.requests(limit=limit, model_id=model_id, status=status)]

    @application.get("/api/requests/{request_id}")
    async def request_detail(request_id: str):
        return require("requests", request_id)

    @application.get("/api/dashboard")
    async def dashboard():
        return svc().dashboard()

    @application.get("/metrics", include_in_schema=False)
    async def metrics():
        return Response(generate_latest(svc().registry), headers={"Content-Type": CONTENT_TYPE_LATEST})

    # Only an explicit build directory is public; runtime/data/source files are never mounted.
    if config.frontend_path.is_dir():
        application.mount("/assets", StaticFiles(directory=config.frontend_path / "assets"), name="assets")

    @application.get("/", include_in_schema=False)
    async def index():
        index_file = config.frontend_path / "index.html"
        if index_file.is_file():
            return FileResponse(index_file)
        return JSONResponse(
            {
                "name": "ModelOps Lab",
                "message": "API ready. Start the frontend dev server or build frontend/dist.",
                "docs": f"{config.root_path}/docs",
            }
        )

    @application.get("/favicon.svg", include_in_schema=False)
    async def favicon():
        path = config.frontend_path / "favicon.svg"
        if path.is_file():
            return FileResponse(path)
        return Response(status_code=204)

    def custom_openapi():
        if application.openapi_schema:
            return application.openapi_schema
        schema = get_openapi(
            title=application.title,
            version=application.version,
            description=application.description,
            routes=application.routes,
            servers=application.servers,
        )
        schema.setdefault("components", {}).setdefault("securitySchemes", {})["AccessKey"] = {
            "type": "http",
            "scheme": "bearer",
            "description": "Optional MODEL_OPS_API_KEY configured by the administrator",
        }
        for path, operations in schema["paths"].items():
            if path.startswith("/api/") and path != "/api/health":
                for operation in operations.values():
                    if isinstance(operation, dict):
                        operation["security"] = [{"AccessKey": []}]
        application.openapi_schema = schema
        return schema

    application.openapi = custom_openapi
    return application


app = create_app()

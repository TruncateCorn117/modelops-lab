"""Bound request bodies before JSON decoding, including chunked transfer bodies."""

from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send


def route_path(scope: Scope) -> str:
    """Handle both prefix-stripping proxies and ASGI servers retaining root_path."""
    path = scope["path"]
    root = scope.get("root_path", "").rstrip("/")
    if root and (path == root or path.startswith(root + "/")):
        return path[len(root) :] or "/"
    return path


class BodySizeLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int = 12 * 1024 * 1024):
        self.app, self.max_bytes = app, max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if (
            scope["type"] != "http"
            or scope["method"] not in {"POST", "PUT", "PATCH"}
            or not route_path(scope).startswith("/api/")
        ):
            return await self.app(scope, receive, send)
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            if len(body) + len(chunk) > self.max_bytes:
                request_id = scope.get("state", {}).get("request_id", "")
                response = JSONResponse(
                    {
                        "error": {
                            "code": "payload_too_large",
                            "message": "Request body exceeds 12 MB",
                            "request_id": request_id,
                        }
                    },
                    status_code=413,
                )
                return await response(scope, receive, send)
            body.extend(chunk)
            if not message.get("more_body", False):
                break
        replayed = False

        async def bounded_receive() -> Message:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, bounded_receive, send)

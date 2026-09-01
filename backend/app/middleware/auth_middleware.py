from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from ..utils.security import decode_token

# Paths under /api/protected that are intentionally public (no JWT required).
# Clients need these to know whether cloud sync is available before logging in.
_PUBLIC_PROTECTED_PATHS: set[str] = {
    "/api/protected/sync/status",
}


class AuthMiddleware(BaseHTTPMiddleware):
    """
    Validates JWT tokens only for protected endpoints.
    Protected endpoints are expected to start with /api/protected.
    Paths listed in _PUBLIC_PROTECTED_PATHS are exempt from JWT enforcement.
    """

    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS":
            return await call_next(request)

        if request.url.path.startswith("/api/protected"):
            # Allow explicitly public sub-paths through without a token
            if request.url.path in _PUBLIC_PROTECTED_PATHS:
                return await call_next(request)

            auth_header = request.headers.get("Authorization", "")
            if not auth_header.startswith("Bearer "):
                return JSONResponse({"detail": "Missing bearer token."}, status_code=401)

            token = auth_header[len("Bearer "):].strip()
            try:
                payload = decode_token(token)
                request.state.user_email = payload.get("sub")
            except ValueError:
                return JSONResponse({"detail": "Invalid or expired token."}, status_code=401)

        return await call_next(request)

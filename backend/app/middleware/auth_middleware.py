from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from ..utils.security import decode_token


class AuthMiddleware(BaseHTTPMiddleware):
    """
    Validates JWT tokens only for protected endpoints.
    Protected endpoints are expected to start with /api/protected.
    """

    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS":
            return await call_next(request)

        if request.url.path.startswith("/api/protected"):
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

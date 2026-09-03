"""
MongoDB-backed FastAPI authentication dependencies.
These produce the authenticated user identity from the validated JWT only.

SECURITY RULES:
- user_id is NEVER accepted from request bodies, query params, or URL params.
- The effective user identity always comes from the verified JWT claim (sub = email).
- MongoDB user lookup validates the identity against the database on every request.
- user_id from the MongoDB document is the canonical, authoritative identity.
"""

import logging
from fastapi import Depends, HTTPException, Request, status
from typing import Optional

from ..mongodb import get_mongo_db
from ..utils.security import decode_token

logger = logging.getLogger("aymo.auth_deps_mongo")


class AuthenticatedUser:
    """
    Represents the server-verified, JWT-sourced user identity.
    All fields are populated from the database, never from client input.
    """
    def __init__(self, user_id: str, email: str, workspace_ids: Optional[list] = None):
        self.user_id = user_id
        self.email = email
        self.workspace_ids = workspace_ids or []

    def __repr__(self):
        return f"AuthenticatedUser(id={self.user_id}, email={self.email})"


async def get_current_mongo_user(request: Request) -> AuthenticatedUser:
    """
    FastAPI dependency that resolves the authenticated user from the JWT,
    then verifies existence in MongoDB.

    NEVER trusts any user_id from the client — only the JWT sub (email).

    Raises:
        HTTP 401 — missing, invalid, or expired token
        HTTP 401 — user does not exist in MongoDB
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required. Please log in.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # Read token from Authorization header only (never from body/query/path)
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise credentials_exception

    raw_token = auth_header[len("Bearer "):].strip()
    if not raw_token:
        raise credentials_exception

    # Validate token signature, expiration, and purpose
    try:
        payload = decode_token(raw_token)
    except ValueError:
        # Covers: invalid signature, expired, malformed, wrong purpose
        raise credentials_exception

    email: Optional[str] = payload.get("sub")
    if not email:
        raise credentials_exception

    # Look up the user in MongoDB — never trust the email alone without DB confirmation
    db = get_mongo_db()
    if db is None:
        # MongoDB offline: cannot verify user identity for cloud routes
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cloud services are temporarily unavailable. Local notes continue working normally.",
        )

    from ..repositories.mongo_repository import UserMongoRepository
    user_repo = UserMongoRepository(db)
    user_doc = await user_repo.get_by_email(email)
    if not user_doc:
        # Valid JWT but user not found — account may have been deleted
        logger.warning(f"[AUTH] Valid JWT for email={email} but no user in MongoDB.")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account not found. Please log in again.",
        )

    return AuthenticatedUser(
        user_id=user_doc.id,
        email=user_doc.email,
    )


async def require_workspace_access(
    workspace_id: str,
    current_user: AuthenticatedUser
) -> str:
    """
    Validates that the authenticated user owns or has access to the given workspace_id.
    Returns the workspace_id if valid.

    SECURITY:
    - Checks explicit `workspaces` collection first.
    - If owned by current user -> GRANTED.
    - If owned by another user -> DENIED (403).
    - If unowned -> Auto-registers to current user on first access.
    """
    if not workspace_id or not str(workspace_id).strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="workspace_id is required."
        )

    db = get_mongo_db()
    if db is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cloud services temporarily unavailable.",
        )

    # 1. Check explicit workspaces collection
    ws_doc = await db.workspaces.find_one({"_id": workspace_id})
    if ws_doc:
        if ws_doc.get("owner_user_id") == current_user.user_id:
            return workspace_id
        else:
            logger.warning(
                f"[AUTH] User {current_user.user_id} attempted to access workspace {workspace_id} "
                f"owned by {ws_doc.get('owner_user_id')}"
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access to this workspace is not authorized.",
            )

    # 2. Check remote_mappings as fallback
    registered_mapping = await db.remote_mappings.find_one({
        "workspace_id": workspace_id,
    })
    if registered_mapping:
        if registered_mapping.get("user_id") != current_user.user_id:
            logger.warning(
                f"[AUTH] User {current_user.user_id} attempted to access mapping in workspace {workspace_id} "
                f"owned by {registered_mapping.get('user_id')}"
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access to this workspace is not authorized.",
            )
        return workspace_id

    # 3. Unregistered workspace: MUST be explicitly registered via POST /api/protected/sync/workspace/register
    logger.warning(
        f"[AUTH] User {current_user.user_id} attempted to access unregistered workspace {workspace_id}"
    )
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Workspace is not registered. Please register workspace before syncing.",
    )

import hashlib
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response, WebSocket, WebSocketDisconnect

from ..config import get_settings
from ..dependencies.mongo_auth import AuthenticatedUser, get_current_mongo_user, get_optional_mongo_user
from ..mongodb import get_mongo_db
from ..repositories.mongo_repository import (
    AiCacheMongoRepository,
    FileMongoRepository,
    NoteMongoRepository,
    UserMongoRepository,
)
from ..schemas.ai import AIChatRequest, AIChatResponse, AIResponseItem, AIResponseList, NoteContextPayload
from ..services.ai import AIProviderError
from ..services.ai.context import build_conversation_context_mongo, build_system_prompt
from ..services.ai.orchestrator import stream_ai_response
from ..services.ai.router import get_provider_clients
from ..utils.security import decode_token

logger = logging.getLogger("aymo.ai_route")

router = APIRouter(prefix="/api/protected", tags=["ai"])
ws_router = APIRouter(tags=["ai"])


class ResolvedAINote:
    def __init__(self, title: str, body: str, mongo_note_id: Optional[str] = None):
        self.title = title
        self.body = body
        self.mongo_note_id = mongo_note_id

    @property
    def content_hash(self) -> str:
        return hashlib.sha256(f"{self.title}\n{self.body}".encode("utf-8")).hexdigest()[:16]


async def resolve_note_for_ai(
    db,
    note_id: str,
    user_id: Optional[str],
    client_note_context: Optional[NoteContextPayload] = None,
) -> ResolvedAINote:
    """
    Resolves note context for AI execution without requiring prior synchronization.

    If user_id is None (anonymous local user):
      - Must provide client_note_context (HTTP 400 if missing).
      - Performs zero MongoDB note/user lookups.
      - Returns ResolvedAINote directly from client_note_context.
    """
    if user_id is None:
        if client_note_context is not None and (
            client_note_context.title is not None or client_note_context.body is not None
        ):
            return ResolvedAINote(
                title=client_note_context.title or "",
                body=client_note_context.body or "",
                mongo_note_id=None,
            )
        raise HTTPException(
            status_code=400,
            detail="note_context is required for unauthenticated AI chat.",
        )

    # Authenticated user flow
    mongo_note = None
    if db is not None:
        note_repo = NoteMongoRepository(db)
        mongo_note = await note_repo.get_by_id(str(note_id), user_id)

        if mongo_note is None:
            # Check if note exists under any other user (tenant isolation guard)
            any_note = await db.notes.find_one({"_id": str(note_id)})
            if any_note and any_note.get("user_id") != user_id:
                raise HTTPException(
                    status_code=403,
                    detail="Access to this note is not authorized.",
                )

            # Fall back: note_id might be a remoteId from remote_mappings.
            mapping = await db.remote_mappings.find_one(
                {"remote_id": str(note_id), "entity_type": "note", "user_id": user_id}
            )
            if mapping:
                local_id = mapping["local_id"]
                mongo_note = await note_repo.get_by_id(local_id, user_id)

    if mongo_note is not None:
        title = client_note_context.title if (client_note_context and client_note_context.title is not None) else mongo_note.title
        body = client_note_context.body if (client_note_context and client_note_context.body is not None) else mongo_note.body
        return ResolvedAINote(title=title or "", body=body or "", mongo_note_id=mongo_note.id)

    if client_note_context is not None:
        return ResolvedAINote(
            title=client_note_context.title or "",
            body=client_note_context.body or "",
            mongo_note_id=None,
        )

    raise HTTPException(status_code=404, detail="Note not found.")


async def _get_mongo_note_or_authorize(db, note_id: str, user_id: str):
    resolved = await resolve_note_for_ai(db, note_id, user_id)
    if resolved.mongo_note_id is not None:
        note_repo = NoteMongoRepository(db)
        note = await note_repo.get_by_id(resolved.mongo_note_id, user_id)
        if note is not None:
            return note
    from types import SimpleNamespace
    return SimpleNamespace(id=str(note_id), title=resolved.title, body=resolved.body)


@router.post("/ai/chat", response_model=AIChatResponse)
async def chat_with_ai(
    payload: AIChatRequest,
    response: Response,
    current_user: Optional[AuthenticatedUser] = Depends(get_optional_mongo_user),
):
    db = get_mongo_db()
    note_id_str = str(payload.note_id)
    user_id = current_user.user_id if current_user else None

    resolved = await resolve_note_for_ai(db, note_id_str, user_id, payload.note_context)

    user_language = "en"
    preferred_ai_provider = "gemini"

    if current_user and db is not None:
        user_repo = UserMongoRepository(db)
        user_doc = await user_repo.get_by_id(current_user.user_id)
        if user_doc:
            user_language = (user_doc.preferred_language or "en")
            preferred_ai_provider = (user_doc.preferred_ai_provider or "gemini")

    requested_provider = payload.ai_provider.value if payload.ai_provider is not None else None
    provider_name = requested_provider or preferred_ai_provider
    content_hash = resolved.content_hash

    ai_cache_repo = AiCacheMongoRepository(db) if (db is not None and current_user) else None
    if ai_cache_repo and current_user:
        cached = await ai_cache_repo.get_or_create(
            note_id=note_id_str,
            user_id=current_user.user_id,
            question=payload.message,
            provider=provider_name,
            content_hash=content_hash,
        )
        if cached is not None:
            return AIChatResponse(
                note_id=payload.note_id,
                provider=cached["provider"],
                response=cached["response"],
                cached=True,
            )

    recent_responses = []
    file_summaries = []
    extracted_items = []

    if current_user and db is not None:
        if ai_cache_repo:
            recent_responses = await ai_cache_repo.get_cached_responses(note_id_str, current_user.user_id)
        if resolved.mongo_note_id:
            file_repo = FileMongoRepository(db)
            file_docs = await file_repo.list_for_note(resolved.mongo_note_id, current_user.user_id)
            file_summaries = [f"{f.file_name} ({f.file_type}) - status: {f.extraction_status}" for f in file_docs]
            extracted_items = [{"source": f.file_name, "extracted_text": f.extracted_text} for f in file_docs if f.extracted_text]

    settings = get_settings()
    context_text = build_conversation_context_mongo(
        note_title=resolved.title,
        note_body=resolved.body,
        current_message=payload.message,
        user_language=user_language,
        recent_responses=recent_responses,
        file_summaries=file_summaries,
        extracted_items=extracted_items,
        memory_window_size=settings.ai_memory_window_size,
        max_total_tokens=settings.ai_max_context_tokens,
    )

    system_prompt = build_system_prompt(user_language)
    clients = get_provider_clients(provider_name)
    if not clients:
        raise HTTPException(
            status_code=503,
            detail="No configured AI providers are available.",
        )

    response_text = ""
    used_provider = provider_name
    for p_name, client in clients:
        try:
            chunks = client.stream(system_prompt, context_text)
            response_text = "".join(chunks).strip()
            if response_text:
                used_provider = p_name
                break
        except Exception as exc:
            logger.warning(f"AI provider {p_name} failed: {exc}")
            continue

    if not response_text:
        raise HTTPException(status_code=502, detail="The AI provider returned an empty response.")

    if ai_cache_repo and current_user:
        stored = await ai_cache_repo.store(
            note_id=note_id_str,
            user_id=current_user.user_id,
            question=payload.message,
            response=response_text,
            provider=used_provider,
            content_hash=content_hash,
        )
        response_text = stored.get("response", response_text)

    return AIChatResponse(
        note_id=payload.note_id,
        provider=used_provider,
        response=response_text,
        cached=False,
    )


@router.get("/ai/response/{note_id}", response_model=AIResponseList)
async def list_cached_responses(
    note_id: str,
    current_user: AuthenticatedUser = Depends(get_current_mongo_user),
):
    db = get_mongo_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Cloud services temporarily unavailable.")

    try:
        await resolve_note_for_ai(db, str(note_id), current_user.user_id)
    except HTTPException as exc:
        if exc.status_code == 403:
            raise exc

    ai_cache_repo = AiCacheMongoRepository(db)
    items_raw = await ai_cache_repo.get_cached_responses(str(note_id), current_user.user_id)
    items = [AIResponseItem(**item) for item in items_raw]
    return AIResponseList(items=items, total=len(items))


@ws_router.websocket("/ws/ai/chat/{note_id}")
async def websocket_chat(websocket: WebSocket, note_id: str):
    db = get_mongo_db()

    token = (websocket.query_params.get("token") or "").strip()
    user_doc = None
    if token:
        try:
            payload = decode_token(token)
            email = (payload.get("sub") or "").lower().strip()
            if db is not None:
                user_repo = UserMongoRepository(db)
                user_doc = await user_repo.get_by_email(email)
            if not user_doc:
                await websocket.close(code=4401)
                return
        except ValueError:
            await websocket.close(code=4401)
            return

    await websocket.accept()
    ai_cache_repo = AiCacheMongoRepository(db) if (db is not None and user_doc) else None
    file_repo = FileMongoRepository(db) if (db is not None and user_doc) else None
    settings = get_settings()

    user_language = (user_doc.preferred_language if user_doc else "en") or "en"
    preferred_ai_provider = (user_doc.preferred_ai_provider if user_doc else "gemini") or "gemini"
    user_id = user_doc.id if user_doc else None

    try:
        while True:
            data = await websocket.receive_json()
            message = (data.get("message") or "").strip()
            requested_provider = (data.get("ai_provider") or "").strip() or None
            provider_name = requested_provider or preferred_ai_provider

            if not message:
                await websocket.send_json({"type": "error", "detail": "Message cannot be empty."})
                continue

            note_ctx_raw = data.get("note_context")
            client_note_context = None
            if isinstance(note_ctx_raw, dict):
                client_note_context = NoteContextPayload(
                    title=note_ctx_raw.get("title", ""),
                    body=note_ctx_raw.get("body", ""),
                )

            try:
                resolved = await resolve_note_for_ai(db, str(note_id), user_id, client_note_context)
            except HTTPException as exc:
                if exc.status_code == 403:
                    await websocket.send_json({"type": "error", "detail": "Access to this note is not authorized."})
                    await websocket.close(code=4403)
                    return
                else:
                    await websocket.send_json({"type": "error", "detail": exc.detail or "Note not found."})
                    continue

            content_hash = resolved.content_hash

            if ai_cache_repo and user_id:
                cached = await ai_cache_repo.get_or_create(
                    note_id=str(note_id),
                    user_id=user_id,
                    question=message,
                    provider=provider_name,
                    content_hash=content_hash,
                )
                if cached is not None:
                    await websocket.send_json({
                        "type": "complete",
                        "provider": cached["provider"],
                        "content": cached["response"],
                        "cached": True,
                    })
                    continue

            recent_responses = []
            file_summaries = []
            extracted_items = []

            if user_id and db is not None:
                if ai_cache_repo:
                    recent_responses = await ai_cache_repo.get_cached_responses(str(note_id), user_id)
                if resolved.mongo_note_id and file_repo:
                    file_docs = await file_repo.list_for_note(resolved.mongo_note_id, user_id)
                    file_summaries = [f"{f.file_name} ({f.file_type}) - status: {f.extraction_status}" for f in file_docs]
                    extracted_items = [{"source": f.file_name, "extracted_text": f.extracted_text} for f in file_docs if f.extracted_text]

            context_text = build_conversation_context_mongo(
                note_title=resolved.title,
                note_body=resolved.body,
                current_message=message,
                user_language=user_language,
                recent_responses=recent_responses,
                file_summaries=file_summaries,
                extracted_items=extracted_items,
                memory_window_size=settings.ai_memory_window_size,
                max_total_tokens=settings.ai_max_context_tokens,
            )

            system_prompt = build_system_prompt(user_language)
            clients = get_provider_clients(provider_name)
            if not clients:
                await websocket.send_json({"type": "error", "detail": "No AI providers available."})
                continue

            response_parts = []
            used_provider = provider_name
            for p_name, client in clients:
                try:
                    for chunk in client.stream(system_prompt, context_text):
                        if chunk:
                            response_parts.append(chunk)
                            await websocket.send_json({"type": "delta", "provider": p_name, "content": chunk})
                    if response_parts:
                        used_provider = p_name
                        break
                except Exception as exc:
                    logger.warning(f"WebSocket AI provider {p_name} stream error: {exc}")
                    continue

            full_response = "".join(response_parts).strip()
            if full_response:
                if ai_cache_repo and user_id:
                    stored = await ai_cache_repo.store(
                        note_id=str(note_id),
                        user_id=user_id,
                        question=message,
                        response=full_response,
                        provider=used_provider,
                        content_hash=content_hash,
                    )
                    full_response = stored.get("response", full_response)
                await websocket.send_json({
                    "type": "complete",
                    "provider": used_provider,
                    "content": full_response,
                    "cached": False,
                })
            else:
                await websocket.send_json({"type": "error", "detail": "The AI provider returned an empty response."})
    except WebSocketDisconnect:
        pass


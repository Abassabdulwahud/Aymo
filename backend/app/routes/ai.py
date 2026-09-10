import hashlib
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response, WebSocket, WebSocketDisconnect

from ..config import get_settings
from ..dependencies.mongo_auth import AuthenticatedUser, get_current_mongo_user
from ..mongodb import get_mongo_db
from ..repositories.mongo_repository import (
    AiCacheMongoRepository,
    FileMongoRepository,
    NoteMongoRepository,
    UserMongoRepository,
)
from ..schemas.ai import AIChatRequest, AIChatResponse, AIResponseItem, AIResponseList
from ..services.ai import AIProviderError
from ..services.ai.context import build_conversation_context_mongo, build_system_prompt
from ..services.ai.orchestrator import stream_ai_response
from ..services.ai.router import get_provider_clients
from ..utils.security import decode_token

logger = logging.getLogger("aymo.ai_route")

router = APIRouter(prefix="/api/protected", tags=["ai"])
ws_router = APIRouter(tags=["ai"])


async def _get_mongo_note_or_authorize(db, note_id: str, user_id: str):
    """
    Retrieves note for authorized user.

    Resolution order:
      1. Direct lookup by note_id in notes collection (fast path).
      2. Remote-mapping lookup: note_id may be a UUID remoteId assigned by
         sync/push; resolve it to the actual local_id stored as notes._id.
    Raises:
      HTTP 403 Forbidden if note exists under another user_id.
      HTTP 404 Not Found if note does not exist in MongoDB.
    """
    note_repo = NoteMongoRepository(db)
    note = await note_repo.get_by_id(str(note_id), user_id)
    if note is not None:
        return note

    # Check if note exists under any user (ownership guard)
    any_note = await db.notes.find_one({"_id": str(note_id)})
    if any_note and any_note.get("user_id") != user_id:
        raise HTTPException(
            status_code=403,
            detail="Access to this note is not authorized.",
        )

    # Fall back: note_id might be a remoteId from remote_mappings.
    # The sync layer stores notes with _id=local_id but returns a UUID remoteId.
    mapping = await db.remote_mappings.find_one(
        {"remote_id": str(note_id), "entity_type": "note", "user_id": user_id}
    )
    if mapping:
        local_id = mapping["local_id"]
        note = await note_repo.get_by_id(local_id, user_id)
        if note is not None:
            return note

    raise HTTPException(status_code=404, detail="Note not found.")


@router.post("/ai/chat", response_model=AIChatResponse)
async def chat_with_ai(
    payload: AIChatRequest,
    response: Response,
    current_user: AuthenticatedUser = Depends(get_current_mongo_user),
):
    db = get_mongo_db()
    if db is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cloud services are temporarily unavailable.",
        )

    note_id_str = str(payload.note_id)
    note = await _get_mongo_note_or_authorize(db, note_id_str, current_user.user_id)

    user_repo = UserMongoRepository(db)
    user_doc = await user_repo.get_by_id(current_user.user_id)
    user_language = (user_doc.preferred_language if user_doc else "en") or "en"
    preferred_ai_provider = (user_doc.preferred_ai_provider if user_doc else "gemini") or "gemini"

    requested_provider = payload.ai_provider.value if payload.ai_provider is not None else None
    provider_name = requested_provider or preferred_ai_provider

    ai_cache_repo = AiCacheMongoRepository(db)
    cached = await ai_cache_repo.get_or_create(
        note_id=note_id_str,
        user_id=current_user.user_id,
        question=payload.message,
        provider=provider_name,
    )
    if cached is not None:
        return AIChatResponse(
            note_id=payload.note_id,
            provider=cached["provider"],
            response=cached["response"],
            cached=True,
        )

    # Fetch recent responses for conversation memory
    recent_responses = await ai_cache_repo.get_cached_responses(note_id_str, current_user.user_id)

    # Fetch attached file docs
    file_repo = FileMongoRepository(db)
    file_docs = await file_repo.list_for_note(note_id_str, current_user.user_id)
    file_summaries = [f"{f.file_name} ({f.file_type}) - status: {f.extraction_status}" for f in file_docs]
    extracted_items = [{"source": f.file_name, "extracted_text": f.extracted_text} for f in file_docs if f.extracted_text]

    settings = get_settings()
    context_text = build_conversation_context_mongo(
        note_title=note.title,
        note_body=note.body,
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

    stored = await ai_cache_repo.store(
        note_id=note_id_str,
        user_id=current_user.user_id,
        question=payload.message,
        response=response_text,
        provider=used_provider,
    )

    return AIChatResponse(
        note_id=payload.note_id,
        provider=used_provider,
        response=stored["response"],
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

    await _get_mongo_note_or_authorize(db, str(note_id), current_user.user_id)
    ai_cache_repo = AiCacheMongoRepository(db)
    items_raw = await ai_cache_repo.get_cached_responses(str(note_id), current_user.user_id)
    items = [AIResponseItem(**item) for item in items_raw]
    return AIResponseList(items=items, total=len(items))


@ws_router.websocket("/ws/ai/chat/{note_id}")
async def websocket_chat(websocket: WebSocket, note_id: str):
    db = get_mongo_db()
    if db is None:
        await websocket.close(code=4503)
        return

    token = (websocket.query_params.get("token") or "").strip()
    if not token:
        await websocket.close(code=4401)
        return

    try:
        payload = decode_token(token)
        email = (payload.get("sub") or "").lower().strip()
    except ValueError:
        await websocket.close(code=4401)
        return

    user_repo = UserMongoRepository(db)
    user_doc = await user_repo.get_by_email(email)
    if not user_doc:
        await websocket.close(code=4401)
        return

    try:
        note = await _get_mongo_note_or_authorize(db, str(note_id), user_doc.id)
    except HTTPException as exc:
        await websocket.close(code=4403 if exc.status_code == 403 else 4404)
        return

    await websocket.accept()
    ai_cache_repo = AiCacheMongoRepository(db)
    file_repo = FileMongoRepository(db)
    settings = get_settings()

    user_language = user_doc.preferred_language or "en"
    preferred_ai_provider = user_doc.preferred_ai_provider or "gemini"

    try:
        while True:
            data = await websocket.receive_json()
            message = (data.get("message") or "").strip()
            requested_provider = (data.get("ai_provider") or "").strip() or None
            provider_name = requested_provider or preferred_ai_provider

            if not message:
                await websocket.send_json({"type": "error", "detail": "Message cannot be empty."})
                continue

            cached = await ai_cache_repo.get_or_create(
                note_id=str(note_id),
                user_id=user_doc.id,
                question=message,
                provider=provider_name,
            )
            if cached is not None:
                await websocket.send_json({
                    "type": "complete",
                    "provider": cached["provider"],
                    "content": cached["response"],
                    "cached": True,
                })
                continue

            recent_responses = await ai_cache_repo.get_cached_responses(str(note_id), user_doc.id)
            file_docs = await file_repo.list_for_note(str(note_id), user_doc.id)
            file_summaries = [f"{f.file_name} ({f.file_type}) - status: {f.extraction_status}" for f in file_docs]
            extracted_items = [{"source": f.file_name, "extracted_text": f.extracted_text} for f in file_docs if f.extracted_text]

            context_text = build_conversation_context_mongo(
                note_title=note.title,
                note_body=note.body,
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
                stored = await ai_cache_repo.store(
                    note_id=str(note_id),
                    user_id=user_doc.id,
                    question=message,
                    response=full_response,
                    provider=used_provider,
                )
                await websocket.send_json({
                    "type": "complete",
                    "provider": used_provider,
                    "content": stored["response"],
                    "cached": False,
                })
            else:
                await websocket.send_json({"type": "error", "detail": "The AI provider returned an empty response."})
    except WebSocketDisconnect:
        pass

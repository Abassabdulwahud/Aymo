import hashlib
from fastapi import APIRouter, Depends, HTTPException, Response, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import SessionLocal, get_db
from ..dependencies.auth import get_current_user
from ..models.note import Note
from ..models.user import User
from ..repositories.scoped_queries import note_for_user
from ..schemas.ai import AIChatRequest, AIChatResponse, AIResponseItem, AIResponseList
from ..services.ai import AIProviderError
from ..services.ai.context import build_conversation_context, build_note_context
from ..services.ai.orchestrator import (
    get_cached_ai_responses,
    get_or_create_ai_response,
    store_ai_response,
    stream_ai_response,
)
from ..services.embeddings import search_note_embeddings
from ..utils.security import decode_token

router = APIRouter(prefix="/api/protected", tags=["ai"])
ws_router = APIRouter(tags=["ai"])


def _get_note_or_404(db: Session, user_id: int, note_id: int) -> Note:
    note = note_for_user(db, user_id, note_id).first()
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found.")
    return note


@router.post("/ai/chat", response_model=AIChatResponse)
def chat_with_ai(
    payload: AIChatRequest,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note = _get_note_or_404(db, current_user.id, payload.note_id)
    ranked_chunks, embedding_warning = search_note_embeddings(db, note.id, payload.message, limit=20)
    
    settings = get_settings()
    context_text = build_conversation_context(
        db=db,
        note=note,
        user=current_user,
        current_message=payload.message,
        ranked_chunks=ranked_chunks,
        memory_window_size=settings.ai_memory_window_size,
        max_total_tokens=settings.ai_max_context_tokens,
    )
    context_hash = hashlib.sha256(context_text.encode("utf-8")).hexdigest()

    requested_provider = payload.ai_provider.value if payload.ai_provider is not None else None
    provider_name = requested_provider or current_user.preferred_ai_provider.value
    cached, _, _ = get_or_create_ai_response(
        db,
        note,
        current_user,
        payload.message,
        context_text,
        provider_name,
    )
    if cached is not None:
        if embedding_warning:
            response.headers["X-AYMO-Warning"] = embedding_warning
        return AIChatResponse(
            note_id=note.id,
            provider=cached["provider"],
            response=cached["response"],
            cached=True,
        )

    try:
        chunks, provider = stream_ai_response(
            db,
            note,
            current_user,
            payload.message,
            context_text,
            requested_provider,
        )
        response_text = "".join(chunks).strip()
    except AIProviderError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if not response_text:
        raise HTTPException(status_code=502, detail="The AI provider returned an empty response.")

    stored = store_ai_response(db, note, current_user, payload.message, response_text, context_hash, provider)
    if embedding_warning:
        response.headers["X-AYMO-Warning"] = embedding_warning
    return AIChatResponse(
        note_id=note.id,
        provider=provider,
        response=stored["response"],
        cached=stored["cached"],
    )


@router.get("/ai/response/{note_id}", response_model=AIResponseList)
def list_cached_responses(
    note_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_note_or_404(db, current_user.id, note_id)
    items = [AIResponseItem(**item) for item in get_cached_ai_responses(db, note_id, current_user.id)]
    return AIResponseList(items=items, total=len(items))


def _resolve_websocket_user(db: Session, token: str) -> User:
    try:
        payload = decode_token(token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    email = (payload.get("sub") or "").lower()
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    return user


@ws_router.websocket("/ws/ai/chat/{note_id}")
async def websocket_chat(websocket: WebSocket, note_id: int):
    db = SessionLocal()
    try:
        token = (websocket.query_params.get("token") or "").strip()
        if not token:
            raise HTTPException(status_code=401, detail="Missing WebSocket token.")
        current_user = _resolve_websocket_user(db, token)
        note = _get_note_or_404(db, current_user.id, note_id)
        await websocket.accept()

        settings = get_settings()
        while True:
            payload = await websocket.receive_json()
            message = (payload.get("message") or "").strip()
            requested_provider = (payload.get("ai_provider") or "").strip() or None
            if not message:
                await websocket.send_json({"type": "error", "detail": "Message cannot be empty."})
                continue

            ranked_chunks, _ = search_note_embeddings(db, note.id, message, limit=20)
            context_text = build_conversation_context(
                db=db,
                note=note,
                user=current_user,
                current_message=message,
                ranked_chunks=ranked_chunks,
                memory_window_size=settings.ai_memory_window_size,
                max_total_tokens=settings.ai_max_context_tokens,
            )
            context_hash = hashlib.sha256(context_text.encode("utf-8")).hexdigest()

            provider_name = requested_provider or current_user.preferred_ai_provider.value
            cached, _, _ = get_or_create_ai_response(
                db,
                note,
                current_user,
                message,
                context_text,
                provider_name,
            )
            if cached is not None:
                await websocket.send_json(
                    {
                        "type": "complete",
                        "provider": cached["provider"],
                        "content": cached["response"],
                        "cached": True,
                    }
                )
                continue

            try:
                chunks, provider = stream_ai_response(db, note, current_user, message, context_text, requested_provider)
                parts = []
                for chunk in chunks:
                    if not chunk:
                        continue
                    parts.append(chunk)
                    await websocket.send_json({"type": "delta", "provider": provider, "content": chunk})
                response_text = "".join(parts).strip()
                if not response_text:
                    raise AIProviderError("The AI provider returned an empty response.")
                stored = store_ai_response(db, note, current_user, message, response_text, context_hash, provider)
                await websocket.send_json(
                    {
                        "type": "complete",
                        "provider": provider,
                        "content": stored["response"],
                        "cached": False,
                    }
                )
            except AIProviderError as exc:
                await websocket.send_json({"type": "error", "detail": str(exc)})
    except HTTPException as exc:
        await websocket.close(code=4401 if exc.status_code == 401 else 4404)
    except WebSocketDisconnect:
        pass
    finally:
        db.close()

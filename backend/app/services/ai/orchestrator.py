import hashlib
from typing import Dict, Iterable, List, Optional, Tuple

from sqlalchemy.orm import Session

from ...config import get_settings
from ...models.ai_response_cache import AIResponseCache
from ...models.enums import AIProvider
from ...models.note import Note
from ...models.user import User
from ..cache import cache_client
from ..encryption import decrypt_text, encrypt_text
from .base import AIProviderError
from .context import build_note_context, build_system_prompt
from .router import get_provider_clients


def _hash_text(value: str) -> str:
    normalized = " ".join((value or "").strip().lower().split())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _cache_key(provider: str, note_id: int, question_hash: str, context_hash: str) -> str:
    return "ai-response:{0}:{1}:{2}:{3}".format(provider, note_id, question_hash, context_hash)


def get_cached_ai_responses(db: Session, note_id: int, user_id: int) -> List[Dict[str, str]]:
    items = (
        db.query(AIResponseCache)
        .filter(AIResponseCache.note_id == note_id, AIResponseCache.user_id == user_id)
        .order_by(AIResponseCache.created_at.desc(), AIResponseCache.id.desc())
        .all()
    )
    responses = []
    for item in items:
        responses.append(
            {
                "id": str(item.id),
                "provider": item.provider,
                "question": decrypt_text(item.encrypted_question or ""),
                "response": decrypt_text(item.encrypted_response),
                "created_at": item.created_at.isoformat(),
            }
        )
    return responses


def get_or_create_ai_response(
    db: Session,
    note: Note,
    current_user: User,
    message: str,
    context_text: Optional[str] = None,
    provider_name: Optional[str] = None,
) -> Tuple[Optional[Dict[str, str]], str, str]:
    settings = get_settings()
    if context_text is None:
        context_text, context_hash = build_note_context(db, note)
    else:
        context_hash = hashlib.sha256(context_text.encode("utf-8")).hexdigest()
    question_hash = _hash_text(message)
    provider_name = provider_name or current_user.preferred_ai_provider.value
    key = _cache_key(provider_name, note.id, question_hash, context_hash)

    cached = cache_client.get_json(key)
    if cached is not None:
        cached["cached"] = True
        return cached, context_text, context_hash

    existing = (
        db.query(AIResponseCache)
        .filter(
            AIResponseCache.note_id == note.id,
            AIResponseCache.user_id == current_user.id,
            AIResponseCache.provider == provider_name,
            AIResponseCache.question_hash == question_hash,
            AIResponseCache.context_hash == context_hash,
        )
        .first()
    )
    if existing is None:
        return None, context_text, context_hash

    payload = {
        "id": str(existing.id),
        "provider": existing.provider,
        "question": decrypt_text(existing.encrypted_question or ""),
        "response": decrypt_text(existing.encrypted_response),
        "created_at": existing.created_at.isoformat(),
        "cached": True,
    }
    cache_client.set_json(key, payload, settings.ai_cache_ttl_seconds)
    return payload, context_text, context_hash


def stream_ai_response(
    db: Session,
    note: Note,
    current_user: User,
    message: str,
    context_text: Optional[str] = None,
    preferred_provider: Optional[str] = None,
) -> Tuple[Iterable[str], str]:
    if context_text is not None:
        user_prompt = context_text
    else:
        context_text, _ = build_note_context(db, note)
        user_prompt = "NOTE CONTEXT:\n{0}\n\nUSER QUESTION:\n{1}".format(context_text, message)

    system_prompt = build_system_prompt(current_user.preferred_language)

    provider_to_use = current_user.preferred_ai_provider
    if preferred_provider:
        try:
            provider_to_use = AIProvider(preferred_provider)
        except ValueError:
            provider_to_use = current_user.preferred_ai_provider

    clients = get_provider_clients(provider_to_use)
    if not clients:
        raise AIProviderError("No configured AI providers are available.")

    last_error: Optional[Exception] = None
    for provider_name, client in clients:
        iterator = iter(client.stream(system_prompt, user_prompt))
        try:
            first_chunk = next(iterator)
        except StopIteration:
            last_error = AIProviderError("{0} returned an empty response.".format(provider_name))
            continue
        except AIProviderError as exc:
            last_error = exc
            continue

        def stream_with_first_chunk(initial_chunk: str, remaining: Iterable[str]) -> Iterable[str]:
            if initial_chunk:
                yield initial_chunk
            for chunk in remaining:
                if chunk:
                    yield chunk

        return stream_with_first_chunk(first_chunk, iterator), provider_name

    if last_error is not None:
        raise AIProviderError(str(last_error))
    raise AIProviderError("No AI provider could return a response.")


def store_ai_response(
    db: Session,
    note: Note,
    current_user: User,
    question: str,
    response_text: str,
    context_hash: str,
    provider_name: Optional[str] = None,
) -> Dict[str, str]:
    settings = get_settings()
    provider_name = provider_name or current_user.preferred_ai_provider.value
    question_hash = _hash_text(question)

    item = AIResponseCache(
        note_id=note.id,
        user_id=current_user.id,
        provider=provider_name,
        question_hash=question_hash,
        context_hash=context_hash,
        encrypted_question=encrypt_text(question),
        encrypted_response=encrypt_text(response_text),
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    payload = {
        "id": str(item.id),
        "provider": provider_name,
        "question": question,
        "response": response_text,
        "created_at": item.created_at.isoformat(),
        "cached": False,
    }
    cache_client.set_json(
        _cache_key(provider_name, note.id, question_hash, context_hash),
        payload,
        settings.ai_cache_ttl_seconds,
    )

    # Trigger background conversation summary update
    from ...database import SessionLocal
    trigger_summary_update(
        db_session_factory=SessionLocal,
        note_id=note.id,
        user_id=current_user.id,
        memory_window_size=settings.ai_memory_window_size,
    )

    return payload


def update_note_conversation_summary(
    db: Session,
    note: Note,
    current_user: User,
    memory_window_size: int,
) -> None:
    from ...models.ai_response_cache import AIResponseCache
    from ..encryption import decrypt_text
    from .context import build_summary_prompt

    # 1. Fetch history ordered by created_at asc
    history = (
        db.query(AIResponseCache)
        .filter(AIResponseCache.note_id == note.id, AIResponseCache.user_id == current_user.id)
        .order_by(AIResponseCache.created_at.asc(), AIResponseCache.id.asc())
        .all()
    )
    N = len(history)
    if N <= memory_window_size:
        return

    # The messages that are NOT in the last memory_window_size are candidates for summary
    candidates = history[0 : N - memory_window_size]
    
    # We only summarize those candidates that have NOT been summarized yet
    to_summarize = [m for m in candidates if not m.is_summarized]
    if not to_summarize:
        return

    # Format the candidate messages to summarize
    lines = []
    for m in to_summarize:
        q = decrypt_text(m.encrypted_question or "")
        r = decrypt_text(m.encrypted_response)
        lines.append(f"User: {q}\nAssistant: {r}")
    oldest_messages = "\n\n".join(lines)

    # Call AI provider to generate updated summary
    provider_to_use = current_user.preferred_ai_provider
    clients = get_provider_clients(provider_to_use)
    if not clients:
        return

    provider_name, client = clients[0]
    system_prompt, user_prompt = build_summary_prompt(note.conversation_summary, oldest_messages)
    
    try:
        summary_chunks = client.stream(system_prompt, user_prompt)
        new_summary = "".join(summary_chunks).strip()
        if new_summary:
            note.conversation_summary = new_summary
            for m in to_summarize:
                m.is_summarized = True
            db.commit()
    except Exception as exc:
        print(f"Failed to generate conversation summary: {exc}")


def trigger_summary_update(db_session_factory, note_id: int, user_id: int, memory_window_size: int):
    import threading
    def _run():
        db = db_session_factory()
        try:
            note = db.query(Note).filter(Note.id == note_id).first()
            user = db.query(User).filter(User.id == user_id).first()
            if note and user:
                update_note_conversation_summary(db, note, user, memory_window_size)
        except Exception as exc:
            print(f"Error in background summary task: {exc}")
        finally:
            db.close()
    
    t = threading.Thread(target=_run)
    t.start()

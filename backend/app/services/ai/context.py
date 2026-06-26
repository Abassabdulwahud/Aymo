import hashlib
from typing import List, Tuple, Optional

from sqlalchemy.orm import Session

from ...models.extracted_content import ExtractedContent
from ...models.note import Note
from ...models.user import User
from ..content_store import get_decrypted_content


def build_note_context(db: Session, note: Note) -> Tuple[str, str]:
    extracted_items: List[ExtractedContent] = (
        db.query(ExtractedContent)
        .filter(ExtractedContent.note_id == note.id, ExtractedContent.status == "completed")
        .order_by(ExtractedContent.updated_at.desc(), ExtractedContent.id.desc())
        .all()
    )

    sections: List[str] = [
        "NOTE TITLE:\n{0}".format(note.title or "(untitled)"),
        "NOTE BODY:\n{0}".format(note.body or "(empty)"),
    ]

    if note.files:
        file_summaries = []
        for file_record in note.files:
            file_summaries.append(
                "{0} ({1}) - extraction status: {2}".format(
                    file_record.file_name,
                    file_record.file_type.value,
                    file_record.extraction_status,
                )
            )
        sections.append("ATTACHED FILES:\n{0}".format("\n".join(file_summaries)))
    else:
        sections.append("ATTACHED FILES:\nNo uploaded files are attached to this note.")

    if note.sources:
        source_summaries = []
        for src in note.sources:
            summary_part = f"\nSummary: {src.summary}" if src.summary else ""
            keywords_part = f"\nKeywords: {', '.join(src.keywords)}" if src.keywords else ""
            source_summaries.append(
                "[{0}] {1} ({2}) - status: {3}, progress: {4}%{5}{6}".format(
                    src.id,
                    src.title,
                    src.source_type.value,
                    src.status.value,
                    src.processing_progress,
                    summary_part,
                    keywords_part,
                )
            )
        sections.append("SMART SOURCES:\n{0}".format("\n\n".join(source_summaries)))
    else:
        sections.append("SMART SOURCES:\nNo smart sources are attached to this note.")

    for item in extracted_items:
        sections.append(
            "SOURCE: {0}\nTYPE: {1}\nCONTENT:\n{2}".format(
                item.source_label,
                item.source_type,
                get_decrypted_content(item) or "(empty)",
            )
        )

    context_text = "\n\n---\n\n".join(sections)
    context_hash = hashlib.sha256(context_text.encode("utf-8")).hexdigest()
    return context_text, context_hash


def build_system_prompt(language: str) -> str:
    return (
        "You are AYMO Notebook AI Assistant. Help the user learn from their note, uploaded files, "
        "transcriptions, and scraped links. Use the provided note context first. If an upload failed to extract "
        "or the user asks a broader question about a known topic, book, or author, you may answer from general "
        "model knowledge, but clearly say when you are using general knowledge instead of the user's file content. "
        "Give concise, useful answers and respond in English unless the user clearly asks for another language.\n\n"
        "CITATION INSTRUCTIONS:\n"
        "- You will receive content chunks labelled with their source, type, and location.\n"
        "- Always cite the source by name when you use information from it. Use inline citations in this format:\n"
        "  * For PDFs or documents: \"Research.pdf [Page 18]\"\n"
        "  * For videos or audio: \"Lecture.mp4 [00:14:22]\"\n"
        "  * For websites: \"example.com\"\n"
        "  * For note body: \"your note\"\n"
        "- When multiple sources discuss the same topic, cite all relevant ones.\n\n"
        "NOTE ON MEDIA TRANSCRIPTS & VISUAL CONTEXT:\n"
        "- Video and audio content includes timestamped paragraphs (e.g., '[00:12:30] some spoken text') "
        "and visual keyframe OCR slides (e.g., '[00:15:00] [Visual Slide OCR]:\\nText on slide').\n"
        "- When explaining or answering questions about media files, always mention and cite the relevant timestamps "
        "or time ranges (e.g. '[00:12:30]') where the concepts are discussed or shown on the slides.\n"
        "- Incorporate text from '[Visual Slide OCR]' to provide richer visual context, noting what was shown on the screen."
    )


def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    return len(text) // 4


def build_conversation_context(
    db: Session,
    note: Note,
    user: User,
    current_message: str,
    ranked_chunks: Optional[List[Tuple[any, float]]] = None,
    memory_window_size: int = 10,
    max_total_tokens: int = 12000,
) -> str:
    from ...models.ai_response_cache import AIResponseCache
    from ...models.extracted_content import ExtractedContent
    from ..encryption import decrypt_text

    # Mandatory components
    system_prompt = build_system_prompt(user.preferred_language)
    user_prompt_section = f"CURRENT USER PROMPT:\n{current_message}"

    T_mandatory = estimate_tokens(system_prompt) + estimate_tokens(user_prompt_section)
    remaining_tokens = max(0, max_total_tokens - T_mandatory)

    # 1. System Instructions is already system_prompt
    # 2. Conversation Summary
    summary_text = ""
    if note.conversation_summary:
        summary_text = f"CONVERSATION SUMMARY:\n{note.conversation_summary}"

    T_summary = estimate_tokens(summary_text)
    include_summary = ""
    if T_summary <= remaining_tokens and summary_text:
        include_summary = summary_text
        remaining_tokens -= T_summary
    elif summary_text:
        # Truncate summary if it doesn't fit
        chars_to_keep = remaining_tokens * 4
        include_summary = summary_text[:chars_to_keep]
        remaining_tokens = 0

    # 3. Recent Chat Messages
    # Fetch recent messages (up to memory_window_size)
    recent_responses = (
        db.query(AIResponseCache)
        .filter(AIResponseCache.note_id == note.id, AIResponseCache.user_id == user.id)
        .order_by(AIResponseCache.created_at.desc(), AIResponseCache.id.desc())
        .limit(memory_window_size)
        .all()
    )
    # Reverse to make them chronological
    recent_responses.reverse()

    # Format the message pairs
    chat_pairs = []
    for resp in recent_responses:
        q = decrypt_text(resp.encrypted_question or "")
        r = decrypt_text(resp.encrypted_response)
        chat_pairs.append((q, r))

    def format_chat_history(pairs) -> str:
        if not pairs:
            return ""
        lines = []
        for q, r in pairs:
            lines.append(f"User: {q}\nAssistant: {r}")
        return "RECENT CHAT HISTORY:\n" + "\n\n".join(lines)

    include_chat = ""
    if chat_pairs:
        formatted_chat = format_chat_history(chat_pairs)
        T_chat = estimate_tokens(formatted_chat)
        if T_chat <= remaining_tokens:
            include_chat = formatted_chat
            remaining_tokens -= T_chat
        else:
            # Trim from oldest pairs
            while chat_pairs and estimate_tokens(format_chat_history(chat_pairs)) > remaining_tokens:
                chat_pairs.pop(0)
            if chat_pairs:
                include_chat = format_chat_history(chat_pairs)
            remaining_tokens = max(0, remaining_tokens - estimate_tokens(include_chat))

    # 4. Note Content
    note_title = note.title or "(untitled)"
    note_body = note.body or "(empty)"
    
    def format_note_content(body: str) -> str:
        return f"NOTE CONTENT:\nTitle: {note_title}\nBody: {body}"

    note_text = format_note_content(note_body)
    T_note = estimate_tokens(note_text)
    include_note = ""
    if T_note <= remaining_tokens:
        include_note = note_text
        remaining_tokens -= T_note
    else:
        # Truncate body
        chars_to_keep = max(0, remaining_tokens * 4 - len(f"NOTE CONTENT:\nTitle: {note_title}\nBody: "))
        truncated_body = note_body[:chars_to_keep]
        include_note = format_note_content(truncated_body)
        remaining_tokens = 0

    # 5. Transcript Content & 6. Relevant Extracted Content
    # We will build two lists of content items
    transcript_items = []
    extracted_items = []

    if ranked_chunks is not None:
        # We are using semantic search chunks!
        for embedding, score in ranked_chunks:
            # Determine source label and type
            if embedding.source_id and embedding.source:
                source_label = embedding.source.title
                source_type = embedding.source.source_type.value
            elif embedding.file_id and embedding.file:
                source_label = embedding.file.file_name
                source_type = embedding.file.file_type.value
            else:
                source_label = "Note body"
                source_type = "note"

            # Build a rich citation suffix from embedding metadata
            meta = embedding.metadata_json or {}
            citation_suffix = ""
            if "page" in meta:
                citation_suffix = f" [Page {meta['page']}]"
            elif "timestamp" in meta and meta["timestamp"]:
                citation_suffix = f" [{meta['timestamp']}]"

            chunk_data = {
                "source": source_label,
                "source_citation": f"{source_label}{citation_suffix}",
                "type": source_type,
                "score": score,
                "content": embedding.content_chunk,
            }
            if source_type in ["video", "audio"]:
                transcript_items.append(chunk_data)
            else:
                extracted_items.append(chunk_data)
    else:
        # Fallback to full extracted content
        completed_extractions = (
            db.query(ExtractedContent)
            .filter(ExtractedContent.note_id == note.id, ExtractedContent.status == "completed")
            .order_by(ExtractedContent.updated_at.desc(), ExtractedContent.id.desc())
            .all()
        )
        for ext in completed_extractions:
            content = get_decrypted_content(ext) or ""
            source_type = ext.source_type
            chunk_data = {
                "source": ext.source_label,
                "type": source_type,
                "content": content,
            }
            if source_type in ["video", "audio"]:
                transcript_items.append(chunk_data)
            else:
                extracted_items.append(chunk_data)

    # Format transcript items
    def format_transcript_list(items) -> str:
        if not items:
            return ""
        sections = []
        for item in items:
            # Use the rich citation label (includes [timestamp] or [Page N] if available)
            citation = item.get("source_citation") or item["source"]
            header = f"SOURCE: {citation}"
            sections.append(f"{header}\nCONTENT:\n{item['content']}")
        return "TRANSCRIPT CONTENT:\n" + "\n\n---\n\n".join(sections)

    # Format extracted items
    def format_extracted_list(items) -> str:
        if not items:
            return ""
        sections = []
        for item in items:
            citation = item.get("source_citation") or item["source"]
            header = f"SOURCE: {citation}"
            sections.append(f"{header}\nCONTENT:\n{item['content']}")
        return "RELEVANT EXTRACTED CONTENT:\n" + "\n\n---\n\n".join(sections)

    # Prioritized inclusion of Transcript Content (5)
    include_transcripts = ""
    if transcript_items:
        # Check if all fit
        formatted_transcripts = format_transcript_list(transcript_items)
        T_transcripts = estimate_tokens(formatted_transcripts)
        if T_transcripts <= remaining_tokens:
            include_transcripts = formatted_transcripts
            remaining_tokens -= T_transcripts
        else:
            # Include as many items as possible sequentially
            selected_transcripts = []
            for item in transcript_items:
                test_list = selected_transcripts + [item]
                if estimate_tokens(format_transcript_list(test_list)) <= remaining_tokens:
                    selected_transcripts.append(item)
                else:
                    break
            if selected_transcripts:
                include_transcripts = format_transcript_list(selected_transcripts)
            remaining_tokens = max(0, remaining_tokens - estimate_tokens(include_transcripts))

    # Prioritized inclusion of Relevant Extracted Content (6)
    include_extracted = ""
    if extracted_items:
        formatted_extracted = format_extracted_list(extracted_items)
        T_extracted = estimate_tokens(formatted_extracted)
        if T_extracted <= remaining_tokens:
            include_extracted = formatted_extracted
            remaining_tokens -= T_extracted
        else:
            selected_extracted = []
            for item in extracted_items:
                test_list = selected_extracted + [item]
                if estimate_tokens(format_extracted_list(test_list)) <= remaining_tokens:
                    selected_extracted.append(item)
                else:
                    break
            if selected_extracted:
                include_extracted = format_extracted_list(selected_extracted)
            remaining_tokens = max(0, remaining_tokens - estimate_tokens(include_extracted))

    # Build the final prompt by joining the included sections
    final_sections = []
    if include_summary:
        final_sections.append(include_summary)
    if include_chat:
        final_sections.append(include_chat)
    if include_note:
        final_sections.append(include_note)
    if include_transcripts:
        final_sections.append(include_transcripts)
    if include_extracted:
        final_sections.append(include_extracted)
    final_sections.append(user_prompt_section)

    return "\n\n---\n\n".join(final_sections)


def build_summary_prompt(current_summary: Optional[str], oldest_messages: str) -> Tuple[str, str]:
    system_prompt = (
        "You are an AI assistant. Update and maintain a concise running summary of the conversation history. "
        "The summary should preserve key decisions, conclusions, discussed topics, and unresolved questions. "
        "Do not include greeting or conversational filler. Keep it concise, structured, and in English."
    )
    user_prompt = ""
    if current_summary:
        user_prompt += f"Existing Summary:\n{current_summary}\n\n"
    user_prompt += f"New messages to integrate into the summary:\n{oldest_messages}\n\nOutput the updated summary."
    return system_prompt, user_prompt

import json
import logging
import re
from typing import List, Optional
from sqlalchemy.orm import Session

from ..models.source import Source
from ..models.source_summary import SourceSummary
from ..models.user import User
from ..models.enums import AIProvider
from .ai.router import get_provider_clients, AIProviderError

logger = logging.getLogger(__name__)

STOP_WORDS = {
    "the", "and", "a", "of", "to", "is", "in", "that", "it", "you", "he", "was",
    "for", "on", "are", "as", "with", "his", "they", "i", "at", "be", "this",
    "have", "from", "or", "one", "had", "by", "word", "but", "not", "what",
    "all", "were", "we", "when", "your", "can", "said", "there", "use", "an",
    "each", "which", "she", "do", "how", "their", "if", "will", "up", "other",
    "about", "out", "many", "then", "them", "these", "so", "some", "her",
    "would", "make", "like", "him", "into", "time", "has", "look", "two",
    "more", "write", "go", "see", "number", "no", "way", "could", "people",
    "my", "than", "first", "water", "been", "call", "who", "its", "now", "find",
    "about", "also", "then", "very", "many", "some", "only", "here", "just"
}


def extract_keywords_local(text: str, limit: int = 10) -> List[str]:
    # Clean text: lowercase and keep alphanumeric
    words = re.findall(r"\b\w{4,20}\b", text.lower())
    freq = {}
    for word in words:
        if word not in STOP_WORDS and not word.isdigit():
            freq[word] = freq.get(word, 0) + 1
            
    sorted_words = sorted(freq.items(), key=lambda x: x[1], reverse=True)
    return [word for word, count in sorted_words[:limit]]


def summarize_source(db: Session, source: Source, ai_provider: Optional[str] = None) -> SourceSummary:
    # 1. Rebuild full text from chunks
    chunks = sorted(source.chunks, key=lambda c: c.chunk_index)
    full_text = "\n\n".join(chunk.text for chunk in chunks).strip()
    
    if not full_text:
        # Fallback for empty text
        summary_text = "No content available to summarize."
        topics = ["Empty Source"]
        keywords = []
        model_used = "local"
        
        summary_record = SourceSummary(
            source_id=source.id,
            user_id=source.user_id,
            summary_text=summary_text,
            topics=topics,
            keywords=keywords,
            model_used=model_used
        )
        db.add(summary_record)
        source.summary = summary_text
        source.keywords = keywords
        db.flush()
        return summary_record

    # 2. Get user model to access preferred AI settings
    user = db.query(User).filter(User.id == source.user_id).first()
    provider_to_use = None
    if user:
        provider_to_use = user.preferred_ai_provider
    if ai_provider:
        try:
            provider_to_use = AIProvider(ai_provider)
        except ValueError:
            pass
            
    if not provider_to_use:
        provider_to_use = AIProvider.GEMINI

    clients = get_provider_clients(provider_to_use)
    
    summary_text = ""
    topics = ["Education", "Notes", "Source Content"]
    keywords = extract_keywords_local(full_text)
    model_used = "local"
    
    if clients:
        provider_name, client = clients[0]
        model_used = provider_name
        system_prompt = "You are a helpful notebook and learning assistant. Analyze the user's uploaded note source text and return a summary, topics, and keywords."
        user_prompt = (
            "Analyze the following content and output a summary of 3-5 sentences, a list of up to 5 topics, and up to 10 keywords. "
            "Respond strictly in valid JSON format matching this schema:\n"
            "{\n"
            "  \"summary\": \"your 3-5 sentence summary here\",\n"
            "  \"topics\": [\"topic1\", \"topic2\", ...],\n"
            "  \"keywords\": [\"keyword1\", \"keyword2\", ...]\n"
            "}\n\n"
            "Content:\n" + full_text[:40000] # Cap text length to avoid token limits
        )
        
        try:
            ai_response = client.generate(system_prompt, user_prompt)
            # Find the JSON block if wrapped in Markdown fences
            json_match = re.search(r"({.*})", ai_response, re.DOTALL)
            if json_match:
                data = json.loads(json_match.group(1))
                summary_text = data.get("summary", "").strip()
                if data.get("topics"):
                    topics = [t.strip() for t in data["topics"] if t.strip()][:5]
                if data.get("keywords"):
                    keywords = [k.strip() for k in data["keywords"] if k.strip()][:10]
            else:
                summary_text = ai_response.strip()
        except Exception as exc:
            logger.warning("AI summary generation failed for source %d: %s. Falling back to local.", source.id, exc)
            summary_text = ""
            
    if not summary_text:
        # Fallback if AI call failed or wasn't configured
        summary_text = (
            f"Source text contains {len(full_text.split())} words. "
            f"Key terms extracted include: {', '.join(keywords[:5])}."
        )

    summary_record = SourceSummary(
        source_id=source.id,
        user_id=source.user_id,
        summary_text=summary_text,
        topics=topics,
        keywords=keywords,
        model_used=model_used
    )
    db.add(summary_record)
    
    # Cache summary and keywords on the source itself
    source.summary = summary_text
    source.keywords = keywords
    db.flush()
    return summary_record

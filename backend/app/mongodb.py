import logging
import asyncio
from typing import Optional
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError
from .config import get_settings

logger = logging.getLogger("aymo.mongodb")
settings = get_settings()

_client: Optional[AsyncIOMotorClient] = None
_db = None
_is_connected = False

async def init_mongodb() -> bool:
    """
    Initializes MongoDB client and pings the database.
    Fails gracefully if MongoDB is offline, keeping the app bootable.
    """
    global _client, _db, _is_connected
    
    if not settings.mongodb_url:
        logger.warning("MONGODB_URL environment variable is not set. Sync service will run local-only.")
        _is_connected = False
        return False

    try:
        logger.info("Connecting to MongoDB...")
        # Short timeout (10 seconds) to prevent startup hangs if offline
        _client = AsyncIOMotorClient(
            settings.mongodb_url,
            serverSelectionTimeoutMS=10000,
            connectTimeoutMS=10000
        )
        
        # Ping the database to verify startup connection
        await _client.admin.command("ping")
        _db = _client.get_database()
        _is_connected = True
        logger.info("Successfully connected and pinged MongoDB.")
        return True
    except (ConnectionFailure, ServerSelectionTimeoutError) as e:
        logger.error(f"Failed to connect to MongoDB on startup: {e}. Graceful local fallback active.")
        _is_connected = False
        return False
    except Exception as e:
        logger.error(f"Unexpected error initializing MongoDB: {e}. Graceful local fallback active.")
        _is_connected = False
        return False

def get_mongo_db():
    """
    Returns the initialized MongoDB database instance, or None if unavailable.
    """
    global _db, _is_connected
    if not _is_connected:
        return None
    return _db

def is_mongo_available() -> bool:
    """
    Quick status flag.
    """
    return _is_connected

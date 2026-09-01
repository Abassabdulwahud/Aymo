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
        import certifi
        # Short timeout (10 seconds) to prevent startup hangs if offline
        _client = AsyncIOMotorClient(
            settings.mongodb_url,
            serverSelectionTimeoutMS=10000,
            connectTimeoutMS=10000,
            tlsCAFile=certifi.where()
        )
        
        # Ping the database to verify startup connection
        await _client.admin.command("ping")
        _db = _client.get_database()
        _is_connected = True
        logger.info("Successfully connected and pinged MongoDB.")
        
        # Ensure indexes in background
        asyncio.create_task(ensure_indexes(_db))
        return True
    except (ConnectionFailure, ServerSelectionTimeoutError) as e:
        logger.error(f"Failed to connect to MongoDB on startup: {e}. Graceful local fallback active.")
        _is_connected = False
        return False
    except Exception as e:
        logger.error(f"Unexpected error initializing MongoDB: {e}. Graceful local fallback active.")
        _is_connected = False
        return False

async def ensure_indexes(db) -> None:
    """
    Idempotently creates necessary indexes on MongoDB collections.
    """
    try:
        if db is None:
            return
        logger.info("Ensuring MongoDB collection indexes...")
        
        # 1. users: unique email
        await db.users.create_index("email", unique=True)
        
        # 2. notes: user query & sync filtering
        await db.notes.create_index([("user_id", 1), ("updated_at", -1)])
        await db.notes.create_index("workspace_id")
        await db.notes.create_index([("user_id", 1), ("deleted_at", 1)])
        
        # 3. files: note & user scoping
        await db.files.create_index("note_id")
        await db.files.create_index("user_id")
        
        # 4. annotations: user & source scoping
        await db.annotations.create_index("user_id")
        await db.annotations.create_index([("source_type", 1), ("source_id", 1)])
        
        # 5. aiCache: user & note lookup
        await db.aiCache.create_index([("user_id", 1), ("note_id", 1)])
        
        # 6. remote_mappings: compound mapping index
        await db.remote_mappings.create_index(
            [("workspace_id", 1), ("entity_type", 1), ("local_id", 1)],
            unique=True
        )
        
        # 7. tombstones: sync pull ordering
        await db.tombstones.create_index([("workspace_id", 1), ("deleted_at", -1)])

        # 8. workspaces: owner query
        await db.workspaces.create_index("owner_user_id")
        logger.info("MongoDB collection indexes ensured successfully.")
    except Exception as e:
        logger.warning(f"Non-critical notice: Index setup returned: {e}")

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

async def close_mongodb() -> None:
    """
    Closes the MongoDB client connection gracefully.
    """
    global _client, _db, _is_connected
    if _client is not None:
        logger.info("Closing MongoDB client connection...")
        _client.close()
        _client = None
        _db = None
        _is_connected = False

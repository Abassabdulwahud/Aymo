# AYMO Notebook Backend

This backend uses:
- FastAPI
- SQLAlchemy ORM
- PostgreSQL
- Alembic migrations

It now includes the full AYMO Notebook core database structure for:
- users
- notes
- tags
- note-to-tag relationships
- uploaded files

## Project layout

Important files:
- [app/config.py](C:\Users\DeLL\Desktop\aymo\backend\app\config.py)
- [app/database.py](C:\Users\DeLL\Desktop\aymo\backend\app\database.py)
- [app/models/user.py](C:\Users\DeLL\Desktop\aymo\backend\app\models\user.py)
- [app/models/note.py](C:\Users\DeLL\Desktop\aymo\backend\app\models\note.py)
- [app/models/tag.py](C:\Users\DeLL\Desktop\aymo\backend\app\models\tag.py)
- [app/models/file.py](C:\Users\DeLL\Desktop\aymo\backend\app\models\file.py)
- [app/models/associations.py](C:\Users\DeLL\Desktop\aymo\backend\app\models\associations.py)
- [app/repositories/scoped_queries.py](C:\Users\DeLL\Desktop\aymo\backend\app\repositories\scoped_queries.py)
- [alembic/env.py](C:\Users\DeLL\Desktop\aymo\backend\alembic\env.py)
- [alembic/versions/20260329_0001_create_core_tables.py](C:\Users\DeLL\Desktop\aymo\backend\alembic\versions\20260329_0001_create_core_tables.py)
- [alembic.ini](C:\Users\DeLL\Desktop\aymo\backend\alembic.ini)

## Database schema

### users
Stores:
- `id`
- `full_name`
- `email`
- `password_hash`
- `profile_picture_url`
- `preferred_ai_provider`
- `preferred_theme`
- `preferred_language`
- `provider`
- `created_at`
- `last_login_at`

### notes
Stores:
- `id`
- `user_id`
- `title`
- `body`
- `is_pinned`
- `is_favorited`
- `created_at`
- `updated_at`

### tags
Stores:
- `id`
- `user_id`
- `name`

Each user has unique tag names through a database constraint.

### note_tags
Many-to-many table linking notes to tags:
- `note_id`
- `tag_id`

### files
Stores:
- `id`
- `note_id`
- `user_id`
- `file_name`
- `file_type`
- `file_url`
- `file_size`
- `uploaded_at`

## Relationships

- One user has many notes
- One user has many tags
- One user has many files
- One note has many files
- Notes and tags are linked through `note_tags`

## Ownership and access control

Every note, tag, and file query should be scoped by `user_id`.

Helper query functions are provided in:
- [scoped_queries.py](C:\Users\DeLL\Desktop\aymo\backend\app\repositories\scoped_queries.py)

Examples:
- `notes_for_user(db, user_id)`
- `tags_for_user(db, user_id)`
- `files_for_user(db, user_id)`
- `note_for_user(db, user_id, note_id)`

Use these patterns in routes and services so users only access their own data.

## Indexes

Indexes are included on frequently queried fields such as:
- `users.email`
- `notes.user_id`
- `tags.user_id`
- `files.user_id`
- `files.note_id`
- `note_tags.note_id + tag_id`

## 1. PostgreSQL setup

Create a PostgreSQL database, for example:

```sql
CREATE DATABASE aymo;
```

Then set `DATABASE_URL` in [backend/.env](C:\Users\DeLL\Desktop\aymo\backend\.env):

```env
DATABASE_URL=postgresql+psycopg2://postgres:postgres@localhost:5432/aymo
```

## 2. Install dependencies

From [backend](C:\Users\DeLL\Desktop\aymo\backend):

```bash
pip install -r requirements.txt
```

## 3. Environment variables

Copy:

```bash
cp .env.example .env
```

On Windows PowerShell, use:

```powershell
Copy-Item .env.example .env
```

Important variables:
- `DATABASE_URL`
- `JWT_SECRET_KEY`
- `PASSWORD_RESET_EXPIRE_MINUTES`
- `PASSWORD_RESET_BASE_URL`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USERNAME`
- `SMTP_PASSWORD`
- `SMTP_FROM_EMAIL`
- `SMTP_FROM_NAME`
- `SMTP_USE_TLS`
- `GOOGLE_CLIENT_ID`
- `APPLE_CLIENT_ID`
- `APPLE_REDIRECT_URI`

## 4. Run migrations

From [backend](C:\Users\DeLL\Desktop\aymo\backend):

Upgrade to latest migration:

```bash
alembic upgrade head
```

On Windows PowerShell, if `alembic` is not on PATH, use:

```powershell
python -m alembic upgrade head
```

Create a new migration after future model changes:

```bash
alembic revision --autogenerate -m "describe change"
```

Windows PowerShell alternative:

```powershell
python -m alembic revision --autogenerate -m "describe change"
```

Apply it:

```bash
alembic upgrade head
```

Rollback one migration:

```bash
alembic downgrade -1
```

Windows PowerShell alternative:

```powershell
python -m alembic downgrade -1
```

## 5. Run the API

```bash
uvicorn app.main:app --reload --port 8000
```

Docs:
- `http://127.0.0.1:8000/docs`

## Notes API

Protected note routes are available under:
- `GET /api/protected/notes`
- `POST /api/protected/notes`
- `GET /api/protected/notes/{note_id}`
- `PATCH /api/protected/notes/{note_id}`
- `DELETE /api/protected/notes/{note_id}`
- `POST /api/protected/notes/{note_id}/pin`
- `POST /api/protected/notes/{note_id}/favorite`

These routes require:
- `Authorization: Bearer <jwt_token>`

Supported list filters:
- `search`
- `pinned`
- `favorited`
- `tag_id`

## Tags API

Protected tag routes are available under:
- `GET /api/protected/tags`
- `POST /api/protected/tags`
- `GET /api/protected/tags/{tag_id}`
- `PATCH /api/protected/tags/{tag_id}`
- `DELETE /api/protected/tags/{tag_id}`

These routes also require:
- `Authorization: Bearer <jwt_token>`

## Important note

The app no longer depends on startup `create_all()` for schema creation.
Run Alembic migrations before starting the app against a new database.

If you already have an older local auth-only database from previous AYMO Notebook work,
this migration should be applied to a fresh PostgreSQL database. Reusing an older schema
without a matching Alembic history will need a dedicated follow-up migration or a clean
database reset.

## Current enums

### preferred_ai_provider
- `gemini`
- `openai`
- `deepseek`

### preferred_theme
- `light`
- `dark`

### file_type
- `pdf`
- `video`
- `audio`
- `document`
- `link`

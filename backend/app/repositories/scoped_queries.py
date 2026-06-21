from sqlalchemy.orm import Query, Session

from ..models.file import File
from ..models.note import Note
from ..models.tag import Tag


def notes_for_user(db: Session, user_id: int) -> Query:
    return db.query(Note).filter(Note.user_id == user_id)


def tags_for_user(db: Session, user_id: int) -> Query:
    return db.query(Tag).filter(Tag.user_id == user_id)


def files_for_user(db: Session, user_id: int) -> Query:
    return db.query(File).filter(File.user_id == user_id)


def note_for_user(db: Session, user_id: int, note_id: int) -> Query:
    return notes_for_user(db, user_id).filter(Note.id == note_id)


def tag_for_user(db: Session, user_id: int, tag_id: int) -> Query:
    return tags_for_user(db, user_id).filter(Tag.id == tag_id)


def file_for_user(db: Session, user_id: int, file_id: int) -> Query:
    return files_for_user(db, user_id).filter(File.id == file_id)

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    email = getattr(request.state, "user_email", None)
    if not email:
        raise HTTPException(status_code=401, detail="Missing authenticated user.")

    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")

    return user

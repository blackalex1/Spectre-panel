import time
from backend.models import UserSession
import backend.database

def add_session_db(session_id: str, username: str, duration_days: int):
    expires_at = int(time.time()) + (duration_days * 24 * 60 * 60)
    with backend.database.db_session() as session:
        db_sess = UserSession(
            session_id=session_id,
            username=username,
            created_at=int(time.time()),
            expires_at=expires_at
        )
        session.add(db_sess)

def get_session_db(session_id: str):
    with backend.database.db_session() as session:
        db_sess = session.query(UserSession).filter_by(session_id=session_id).first()
        if db_sess:
            return {
                "session_id": db_sess.session_id,
                "username": db_sess.username,
                "created_at": db_sess.created_at,
                "expires_at": db_sess.expires_at
            }
        return None

def delete_session_db(session_id: str):
    with backend.database.db_session() as session:
        db_sess = session.query(UserSession).filter_by(session_id=session_id).first()
        if db_sess:
            session.delete(db_sess)
            return True
        return False

def clean_expired_sessions_db():
    now = int(time.time())
    with backend.database.db_session() as session:
        session.query(UserSession).filter(UserSession.expires_at < now).delete()

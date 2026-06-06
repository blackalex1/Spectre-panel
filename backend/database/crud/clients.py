from backend.models import ClientStats
import backend.database

def client_to_dict(c: ClientStats) -> dict:
    if not c:
        return None
    return {
        "id": c.id,
        "inbound_id": c.inbound_id,
        "email": c.email,
        "client_uuid_or_pwd": c.client_uuid_or_pwd,
        "up": c.up,
        "down": c.down,
        "total": c.total,
        "expiry_time": c.expiry_time,
        "enable": c.enable,
        "limit_ip": c.limit_ip,
        "block_reason": c.block_reason or ""
    }

def get_clients_for_inbound(inbound_id: int):
    with backend.database.db_session() as session:
        clients = session.query(ClientStats).filter_by(inbound_id=inbound_id).all()
        return [backend.database.client_to_dict(c) for c in clients]

def get_client_by_email(inbound_id: int, email: str):
    with backend.database.db_session() as session:
        c = session.query(ClientStats).filter_by(inbound_id=inbound_id, email=email).first()
        return backend.database.client_to_dict(c)

def get_client_by_id_or_pwd(inbound_id: int, client_id: str):
    with backend.database.db_session() as session:
        c = session.query(ClientStats).filter(
            (ClientStats.inbound_id == inbound_id) & 
            ((ClientStats.client_uuid_or_pwd == client_id) | (ClientStats.email == client_id))
        ).first()
        return backend.database.client_to_dict(c)

def add_client_db(inbound_id: int, email: str, client_uuid_or_pwd: str, total_gb: int = 0, expiry_time: int = 0, limit_ip: int = 0, enable: int = 1, block_reason: str = ""):
    with backend.database.db_session() as session:
        # Проверка уникальности email для данного inbound
        existing = session.query(ClientStats).filter_by(inbound_id=inbound_id, email=email).first()
        if existing:
            return False
            
        total_bytes = total_gb * 1024 * 1024 * 1024
        c = ClientStats(
            inbound_id=inbound_id,
            email=email,
            client_uuid_or_pwd=client_uuid_or_pwd,
            total=total_bytes,
            expiry_time=expiry_time,
            limit_ip=limit_ip,
            enable=enable,
            block_reason=block_reason if enable == 0 else ""
        )
        session.add(c)
        return True

def update_client_db(inbound_id: int, email: str, total_gb: int = 0, expiry_time: int = 0, limit_ip: int = 0, enable: int = 1, block_reason: str = None):
    with backend.database.db_session() as session:
        c = session.query(ClientStats).filter_by(inbound_id=inbound_id, email=email).first()
        if not c:
            return False
            
        c.total = total_gb * 1024 * 1024 * 1024
        c.expiry_time = expiry_time
        c.limit_ip = limit_ip
        
        if enable == 1:
            c.enable = 1
            c.block_reason = ""
        else:
            c.enable = 0
            if block_reason is not None:
                c.block_reason = block_reason
            elif not c.block_reason:
                c.block_reason = "Заблокирован администратором"
        return True

def block_client_db(inbound_id: int, email: str, reason: str):
    """Блокирует клиента в БД с указанием причины"""
    with backend.database.db_session() as session:
        c = session.query(ClientStats).filter_by(inbound_id=inbound_id, email=email).first()
        if c:
            c.enable = 0
            c.block_reason = reason
            return True
        return False

def unblock_client_db(inbound_id: int, email: str):
    """Разблокирует клиента в БД и очищает причину блокировки"""
    with backend.database.db_session() as session:
        c = session.query(ClientStats).filter_by(inbound_id=inbound_id, email=email).first()
        if c:
            c.enable = 1
            c.block_reason = ""
            return True
        return False

def delete_client_db(inbound_id: int, email: str):
    with backend.database.db_session() as session:
        c = session.query(ClientStats).filter_by(inbound_id=inbound_id, email=email).first()
        if not c:
            return False
        session.delete(c)
        return True

def update_client_traffic(inbound_id: int, email: str, up_add: int, down_add: int):
    with backend.database.db_session() as session:
        c = session.query(ClientStats).filter_by(inbound_id=inbound_id, email=email).first()
        if c:
            c.up += up_add
            c.down += down_add

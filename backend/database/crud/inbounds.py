import json
from backend.models import Inbound
import backend.database

def inbound_to_dict(ib: Inbound) -> dict:
    if not ib:
        return None
    return {
        "id": ib.id,
        "remark": ib.remark,
        "port": ib.port,
        "protocol": ib.protocol,
        "settings": ib.settings,
        "stream_settings": ib.stream_settings,
        "sniffing": ib.sniffing,
        "enable": ib.enable,
        "up": ib.up,
        "down": ib.down,
        "total": ib.total,
        "expiry_time": ib.expiry_time
    }

def get_all_inbounds():
    with backend.database.db_session() as session:
        ibs = session.query(Inbound).all()
        return [backend.database.inbound_to_dict(ib) for ib in ibs]

def get_inbound_by_id(inbound_id: int):
    with backend.database.db_session() as session:
        ib = session.query(Inbound).filter_by(id=inbound_id).first()
        return backend.database.inbound_to_dict(ib)

def add_inbound(remark: str, port: int, protocol: str, settings_dict: dict, stream_settings_dict: dict = None, sniffing_dict: dict = None, total: int = 0, expiry_time: int = 0):
    with backend.database.db_session() as session:
        # Проверка уникальности порта
        existing = session.query(Inbound).filter_by(port=port).first()
        if existing:
            return None
            
        settings_json = json.dumps(settings_dict)
        stream_json = json.dumps(stream_settings_dict or {})
        sniffing_json = json.dumps(sniffing_dict or {})
        
        ib = Inbound(
            remark=remark,
            port=port,
            protocol=protocol,
            settings=settings_json,
            stream_settings=stream_json,
            sniffing=sniffing_json,
            total=total,
            expiry_time=expiry_time
        )
        session.add(ib)
        session.flush() # Получаем сгенерированный id
        return ib.id

def update_inbound(inbound_id: int, remark: str, port: int, protocol: str, settings_dict: dict, stream_settings_dict: dict = None, sniffing_dict: dict = None, enable: int = 1, total: int = 0, expiry_time: int = 0):
    with backend.database.db_session() as session:
        # Проверка уникальности порта среди других записей
        port_owner = session.query(Inbound).filter_by(port=port).first()
        if port_owner and port_owner.id != inbound_id:
            return False
            
        ib = session.query(Inbound).filter_by(id=inbound_id).first()
        if not ib:
            return False
            
        ib.remark = remark
        ib.port = port
        ib.protocol = protocol
        ib.settings = json.dumps(settings_dict)
        ib.stream_settings = json.dumps(stream_settings_dict or {})
        ib.sniffing = json.dumps(sniffing_dict or {})
        ib.enable = enable
        ib.total = total
        ib.expiry_time = expiry_time
        return True

def delete_inbound(inbound_id: int):
    with backend.database.db_session() as session:
        ib = session.query(Inbound).filter_by(id=inbound_id).first()
        if not ib:
            return False
        session.delete(ib)
        return True

def update_inbound_traffic(inbound_id: int, up_add: int, down_add: int):
    with backend.database.db_session() as session:
        ib = session.query(Inbound).filter_by(id=inbound_id).first()
        if ib:
            ib.up += up_add
            ib.down += down_add

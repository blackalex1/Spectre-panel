import json
import time
import logging
from backend.database import db_session
from backend.models import User, Inbound, ClientStats, SystemSetting
from backend.xray import write_xray_config
from backend.hysteria import restart_hysteria

def create_backup_dump() -> str:
    """Экспортирует всю базу данных в переносимую JSON строку"""
    try:
        with db_session() as session:
            users = session.query(User).all()
            inbounds = session.query(Inbound).all()
            clients = session.query(ClientStats).all()
            settings = session.query(SystemSetting).all()
            
            dump = {
                "version": "1.0",
                "timestamp": int(time.time()),
                "users": [
                    {"username": u.username, "password": u.password} for u in users
                ],
                "system_settings": [
                    {"key": s.key, "value": s.value} for s in settings
                ],
                "inbounds": [
                    {
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
                    } for ib in inbounds
                ],
                "client_stats": [
                    {
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
                    } for c in clients
                ]
            }
            return json.dumps(dump, ensure_ascii=False, indent=2)
    except Exception as e:
        logging.error(f"[Backup] Failed to create database dump: {e}")
        raise e

def restore_backup_dump(dump_str: str) -> tuple[bool, str]:
    """Восстанавливает всю базу данных из JSON строки (клиар-слейт импорт)"""
    try:
        data = json.loads(dump_str)
        if data.get("version") != "1.0":
            return False, "Неподдерживаемая версия резервной копии"
            
        with db_session() as session:
            # 1. Очищаем старые таблицы в порядке зависимости внешних ключей (каскадное удаление)
            session.query(ClientStats).delete()
            session.query(Inbound).delete()
            session.query(User).delete()
            session.query(SystemSetting).delete()
            
            # 2. Восстанавливаем пользователей
            for u in data.get("users", []):
                session.add(User(username=u["username"], password=u["password"]))
                
            # 3. Восстанавливаем системные настройки
            for s in data.get("system_settings", []):
                session.add(SystemSetting(key=s["key"], value=s["value"]))
                
            # 4. Восстанавливаем инбаунды
            for ib in data.get("inbounds", []):
                session.add(Inbound(
                    id=ib["id"],
                    remark=ib["remark"],
                    port=ib["port"],
                    protocol=ib["protocol"],
                    settings=ib["settings"],
                    stream_settings=ib["stream_settings"],
                    sniffing=ib["sniffing"],
                    enable=ib["enable"],
                    up=ib.get("up", 0),
                    down=ib.get("down", 0),
                    total=ib.get("total", 0),
                    expiry_time=ib.get("expiry_time", 0)
                ))
            
            # Фиксируем промежуточное состояние, чтобы ID инбаундов стали доступны для внешних ключей клиентов
            session.flush()
            
            # 5. Восстанавливаем клиентов
            for c in data.get("client_stats", []):
                session.add(ClientStats(
                    inbound_id=c["inbound_id"],
                    email=c["email"],
                    client_uuid_or_pwd=c["client_uuid_or_pwd"],
                    up=c.get("up", 0),
                    down=c.get("down", 0),
                    total=c.get("total", 0),
                    expiry_time=c.get("expiry_time", 0),
                    enable=c.get("enable", 1),
                    limit_ip=c.get("limit_ip", 0),
                    block_reason=c.get("block_reason", "")
                ))
                
        # 6. Обновляем конфигурации и перезапускаем службы
        write_xray_config()
        restart_hysteria()
        
        logging.info("[Backup] Database successfully restored from dump.")
        return True, "База данных успешно восстановлена"
    except Exception as e:
        logging.error(f"[Backup] Failed to restore database dump: {e}")
        return False, f"Ошибка восстановления: {str(e)}"

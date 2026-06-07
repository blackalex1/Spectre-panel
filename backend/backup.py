import json
import time
import logging
import os
import base64
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

from backend.database import db_session
from backend.models import User, Inbound, ClientStats, SystemSetting, Outbound, RoutingRule
from backend.xray import write_xray_config
from backend.hysteria import restart_hysteria

def get_fernet_key(password: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000
    )
    return base64.urlsafe_b64encode(kdf.derive(password.encode("utf-8")))

def encrypt_data(data: str, password: str) -> str:
    salt = os.urandom(16)
    key = get_fernet_key(password, salt)
    f = Fernet(key)
    encrypted = f.encrypt(data.encode("utf-8"))
    return f"enc1:{salt.hex()}:{encrypted.decode('utf-8')}"

def decrypt_data(encrypted_str: str, password: str) -> str:
    if not encrypted_str.startswith("enc1:"):
        raise ValueError("Неподдерживаемый формат шифрования")
    parts = encrypted_str.split(":")
    if len(parts) != 3:
        raise ValueError("Неверный формат зашифрованных данных")
    salt = bytes.fromhex(parts[1])
    ciphertext = parts[2].encode("utf-8")
    key = get_fernet_key(password, salt)
    f = Fernet(key)
    decrypted = f.decrypt(ciphertext)
    return decrypted.decode("utf-8")

def create_backup_dump() -> str:
    """Экспортирует всю базу данных в переносимую JSON строку (с поддержкой опционального шифрования)"""
    try:
        with db_session() as session:
            users = session.query(User).all()
            inbounds = session.query(Inbound).all()
            clients = session.query(ClientStats).all()
            settings = session.query(SystemSetting).all()
            outbounds = session.query(Outbound).all()
            routing_rules = session.query(RoutingRule).all()
            
            dump = {
                "version": "1.1",
                "timestamp": int(time.time()),
                "users": [
                    {
                        "username": u.username, 
                        "password": u.password,
                        "totp_secret": u.totp_secret,
                        "totp_enabled": u.totp_enabled
                    } for u in users
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
                        "block_reason": c.block_reason or "",
                        "last_seen_up": c.last_seen_up,
                        "last_seen_down": c.last_seen_down
                    } for c in clients
                ],
                "outbounds": [
                    {
                        "id": ob.id,
                        "remark": ob.remark,
                        "protocol": ob.protocol,
                        "tag": ob.tag,
                        "settings": ob.settings,
                        "stream_settings": ob.stream_settings,
                        "enable": ob.enable,
                        "is_system": ob.is_system,
                        "up": ob.up,
                        "down": ob.down
                    } for ob in outbounds
                ],
                "routing_rules": [
                    {
                        "id": rr.id,
                        "remark": rr.remark,
                        "outbound_tag": rr.outbound_tag,
                        "inbound_tags": rr.inbound_tags,
                        "users": rr.users,
                        "domains": rr.domains,
                        "ips": rr.ips,
                        "protocols": rr.protocols,
                        "enable": rr.enable,
                        "sort_order": rr.sort_order
                    } for rr in routing_rules
                ]
            }
            
            json_str = json.dumps(dump, ensure_ascii=False, indent=2)
            
            # Проверяем, включено ли шифрование в системных настройках
            from backend.database import get_setting
            encrypt_enabled = get_setting("backup_encrypt", "false") == "true"
            backup_password = get_setting("backup_password", "")
            
            if encrypt_enabled and backup_password:
                try:
                    return encrypt_data(json_str, backup_password)
                except Exception as e:
                    logging.error(f"[Backup] Failed to encrypt backup: {e}")
                    
            return json_str
    except Exception as e:
        logging.error(f"[Backup] Failed to create database dump: {e}")
        raise e

def restore_backup_dump(dump_str: str) -> tuple[bool, str]:
    """Восстанавливает всю базу данных из JSON строки (клиар-слейт импорт)"""
    try:
        data = json.loads(dump_str)
        version = data.get("version", "1.0")
        if version not in ("1.0", "1.1"):
            return False, "Неподдерживаемая версия резервной копии"
            
        with db_session() as session:
            # 1. Очищаем старые таблицы в порядке зависимости внешних ключей (каскадное удаление)
            session.query(ClientStats).delete()
            session.query(Inbound).delete()
            session.query(User).delete()
            session.query(SystemSetting).delete()
            session.query(RoutingRule).delete()
            session.query(Outbound).delete()
            
            # 2. Восстанавливаем пользователей
            for u in data.get("users", []):
                session.add(User(
                    username=u["username"], 
                    password=u["password"],
                    totp_secret=u.get("totp_secret"),
                    totp_enabled=u.get("totp_enabled", 0)
                ))
                
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
            
            # 5. Восстанавливаем аутбаунды
            outbounds_list = data.get("outbounds")
            if outbounds_list is not None:
                for ob in outbounds_list:
                    session.add(Outbound(
                        id=ob["id"],
                        remark=ob["remark"],
                        protocol=ob["protocol"],
                        tag=ob["tag"],
                        settings=ob.get("settings"),
                        stream_settings=ob.get("stream_settings"),
                        enable=ob.get("enable", 1),
                        is_system=ob.get("is_system", 0),
                        up=ob.get("up", 0),
                        down=ob.get("down", 0)
                    ))
            else:
                # Дефолтные семена для старых бэкапов (без outbounds)
                session.add(Outbound(remark="Direct Connection", protocol="freedom", tag="direct", settings="{}", enable=1, is_system=1))
                session.add(Outbound(remark="Block Connection", protocol="blackhole", tag="blocked", settings="{}", enable=1, is_system=1))
            
            # Фиксируем промежуточное состояние, чтобы ID инбаундов и аутбаундов были доступны для внешних ключей и правил
            session.flush()
            
            # 6. Восстанавливаем правила маршрутизации
            rules_list = data.get("routing_rules")
            if rules_list is not None:
                for rr in rules_list:
                    session.add(RoutingRule(
                        id=rr["id"],
                        remark=rr.get("remark"),
                        outbound_tag=rr["outbound_tag"],
                        inbound_tags=rr.get("inbound_tags"),
                        users=rr.get("users"),
                        domains=rr.get("domains"),
                        ips=rr.get("ips"),
                        protocols=rr.get("protocols"),
                        enable=rr.get("enable", 1),
                        sort_order=rr.get("sort_order", 0)
                    ))
            else:
                # Дефолтные семена для старых бэкапов (без routing_rules)
                session.add(RoutingRule(remark="API Traffic", outbound_tag="api", inbound_tags='["api"]', enable=1, sort_order=1))
                session.add(RoutingRule(remark="Block BitTorrent", outbound_tag="blocked", protocols='["bittorrent"]', enable=0, sort_order=2))
                session.add(RoutingRule(remark="Block Ads (AdBlock)", outbound_tag="blocked", domains='["geosite:category-ads-all"]', enable=0, sort_order=3))
                session.add(RoutingRule(remark="Route ChatGPT via WARP", outbound_tag="warp", domains='["domain:openai.com", "domain:chatgpt.com", "domain:oaistatic.com", "domain:oaiusercontent.com"]', enable=0, sort_order=4))
            
            # 7. Восстанавливаем клиентов
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
                    block_reason=c.get("block_reason", ""),
                    last_seen_up=c.get("last_seen_up", 0),
                    last_seen_down=c.get("last_seen_down", 0)
                ))
                
        # 8. Обновляем конфигурации и перезапускаем службы
        write_xray_config()
        restart_hysteria()
        
        logging.info("[Backup] Database successfully restored from dump.")
        return True, "База данных успешно восстановлена"
    except Exception as e:
        logging.error(f"[Backup] Failed to restore database dump: {e}")
        return False, f"Ошибка восстановления: {str(e)}"

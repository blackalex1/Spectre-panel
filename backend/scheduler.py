import os
import time
import logging
import datetime
import json
import asyncio
from pathlib import Path

from backend.config import settings, XRAY_LOG_PATH
from backend.models import ClientStats, Inbound
from backend.database import db_session, get_clients_for_inbound
from backend.xray import remove_client_api, write_xray_config, is_xray_running, restart_xray
from backend.hysteria import kick_client_hysteria_api, restart_hysteria, is_hysteria_running

# Кэш активных IP-адресов в памяти для проверки лимитов:
# { email: { ip: timestamp } }
ACTIVE_IP_CACHE = {}

# Таймер последней отправки уведомления в TG о блокировке
_last_notified_blocks = {}

def parse_recent_xray_ips():
    """Сканирует access.log Xray и собирает список уникальных IP для каждого клиента за последние 3 минуты"""
    global ACTIVE_IP_CACHE
    
    if not XRAY_LOG_PATH.exists():
        return
        
    now_ts = time.time()
    cutoff_ts = now_ts - 180  # 3 минуты
    
    # Очищаем старые IP из кэша
    for email in list(ACTIVE_IP_CACHE.keys()):
        ip_map = ACTIVE_IP_CACHE[email]
        for ip in list(ip_map.keys()):
            if ip_map[ip] < cutoff_ts:
                del ip_map[ip]
        if not ip_map:
            del ACTIVE_IP_CACHE[email]
            
    try:
        # Читаем последние 1000 строк лог-файла
        with open(XRAY_LOG_PATH, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()[-1000:]
            
        for line in lines:
            if "accepted" not in line or "email: " not in line:
                continue
                
            parts = line.strip().split()
            if len(parts) < 4:
                continue
                
            # Проверяем штамп времени лога Xray
            try:
                log_time_str = parts[0] + " " + parts[1]
                log_time = datetime.datetime.strptime(log_time_str, "%Y/%m/%d %H:%M:%S")
                log_ts = log_time.timestamp()
            except Exception:
                log_ts = now_ts  # fallback
                
            if log_ts < cutoff_ts:
                continue
                
            # Извлекаем email
            email_part = line.split("email: ")
            if len(email_part) < 2:
                continue
            email = email_part[1].strip()
            
            # Извлекаем IP
            ip_port = parts[2]
            if ":" in ip_port:
                ip = ip_port.rsplit(":", 1)[0]
                ip = ip.replace("[", "").replace("]", "")
            else:
                ip = ip_port
                
            # Заносим в кэш
            if email not in ACTIVE_IP_CACHE:
                ACTIVE_IP_CACHE[email] = {}
            ACTIVE_IP_CACHE[email][ip] = log_ts
            
    except Exception as e:
        logging.error(f"[Scheduler] Error parsing Xray access logs: {e}")

def enforce_client_limits_and_rules():
    """Основной фоновый планировщик лимитов (запускается каждые 30 секунд)"""
    parse_recent_xray_ips()
    
    now_ts = time.time()
    now_ms = int(now_ts * 1000)
    
    # Флаги о необходимости применить новый конфиг и перезапустить
    need_config_update = False
    
    from backend.database import get_setting
    from backend.i18n import t
    sys_lang = get_setting("language", "ru")
    bot_token = get_setting("telegram_bot_token", "")
    tg_admin_ids = get_setting("telegram_admin_ids", "")
    
    with db_session() as session:
        # Находим всех активных клиентов
        active_clients = session.query(ClientStats).filter_by(enable=1).all()
        
        for c in active_clients:
            inbound = session.query(Inbound).filter_by(id=c.inbound_id).first()
            if not inbound:
                continue
                
            # Вычисление суточной дельты трафика
            current_date = datetime.date.today().isoformat()
            delta_up = c.up - c.last_seen_up if c.up >= c.last_seen_up else c.up
            delta_down = c.down - c.last_seen_down if c.down >= c.last_seen_down else c.down
            
            delta_up = max(0, delta_up)
            delta_down = max(0, delta_down)
            
            if delta_up > 0 or delta_down > 0:
                from backend.models import ClientTrafficDaily
                daily_record = session.query(ClientTrafficDaily).filter_by(email=c.email, date=current_date).first()
                if daily_record:
                    daily_record.up += delta_up
                    daily_record.down += delta_down
                else:
                    new_record = ClientTrafficDaily(
                        email=c.email,
                        date=current_date,
                        up=delta_up,
                        down=delta_down
                    )
                    session.add(new_record)
                    
            c.last_seen_up = c.up
            c.last_seen_down = c.down
                
            block_reason = ""
            
            # 1. Проверка лимита трафика
            if c.total > 0 and (c.up + c.down) >= c.total:
                block_reason = t("traffic_limit_exceeded", sys_lang)
                
            # 2. Проверка срока действия
            elif c.expiry_time > 0 and now_ms > c.expiry_time:
                block_reason = t("subscription_expired", sys_lang)
                
            # 3. Проверка лимита по IP
            elif c.limit_ip > 0:
                active_ips = ACTIVE_IP_CACHE.get(c.email, {})
                if len(active_ips) > c.limit_ip:
                    block_reason = t("ip_limit_exceeded", sys_lang, count=len(active_ips), limit=c.limit_ip)
                    
            if block_reason:
                logging.warning(f"[Scheduler] Blocking client {c.email} on inbound {c.inbound_id} due to: {block_reason}")
                c.enable = 0
                c.block_reason = block_reason
                need_config_update = True
                
                # Мгновенно обрываем сессии клиента без прерывания других
                if inbound.protocol == "hysteria2":
                    kick_client_hysteria_api(inbound.id, c.email)
                else:
                    remove_client_api(inbound.id, c.email)
                    
                # Отправляем уведомление администратору в Telegram
                asyncio_notify_admin(c.email, block_reason, bot_token, tg_admin_ids)
                
    if need_config_update:
        # Перезаписываем конфигурации
        write_xray_config()
        # Для Hysteria 2 нужно перегенерировать и перезапустить процесс, чтобы обновить ACL авторизации
        restart_hysteria()

    # Запуск автомониторинга ядер
    try:
        run_service_watchdog()
    except Exception as e:
        logging.error(f"[Watchdog] Error running watchdog: {e}")
        
    # Запуск автоматического резервного копирования
    try:
        check_and_run_backups()
    except Exception as e:
        logging.error(f"[Backup Scheduler] Error running backups: {e}")

def asyncio_notify_admin(email: str, reason: str, bot_token: str, tg_admin_ids: str):
    """Отправляет алерт о бане в Telegram (вызывается асинхронно в фоне)"""
    global _last_notified_blocks
    
    last_t = _last_notified_blocks.get((email, reason), 0)
    if time.time() - last_t < 600:
        return
        
    _last_notified_blocks[(email, reason)] = time.time()
    
    try:
        if bot_token and tg_admin_ids:
            from aiogram import Bot
            temp_bot = Bot(token=bot_token)
            admin_ids = [x.strip() for x in tg_admin_ids.split(",") if x.strip()]
            for admin_id in admin_ids:
                msg = f"🛑 <b>[Система Лимитов]</b>\nПользователь <code>{email}</code> заблокирован автоматически.\nПричина: <b>{reason}</b>"
                try:
                    loop = asyncio.get_running_loop()
                    
                    async def send_and_close(bot_inst, chat, text):
                        try:
                            await bot_inst.send_message(chat_id=chat, text=text, parse_mode="HTML")
                        finally:
                            await bot_inst.session.close()
                            
                    loop.create_task(send_and_close(temp_bot, admin_id, msg))
                except RuntimeError:
                    # Нет запущенного event loop
                    pass
    except Exception as e:
        logging.error(f"[Scheduler] Failed to send Telegram alert: {e}")

def run_service_watchdog():
    import backend.watchdog_state
    
    backend.watchdog_state.in_watchdog_context = True
    try:
        with db_session() as session:
            # Check active xray inbounds
            has_xray_inbounds = session.query(Inbound).filter(
                Inbound.enable == 1,
                Inbound.protocol.in_(["vless", "vmess", "trojan", "shadowsocks"])
            ).count() > 0
            
            # Check active hysteria inbounds
            hysteria_inbound_ids = [
                ib.id for ib in session.query(Inbound).filter_by(
                    enable=1,
                    protocol="hysteria2"
                ).all()
            ]
            
        # Xray core check
        if has_xray_inbounds:
            if not is_xray_running():
                if backend.watchdog_state.consecutive_xray_restarts < 3:
                    backend.watchdog_state.consecutive_xray_restarts += 1
                    logging.warning(f"[Watchdog] Xray is dead but active inbounds exist. Restarting (attempt {backend.watchdog_state.consecutive_xray_restarts}/3)...")
                    restart_xray()
                else:
                    logging.error("[Watchdog] Xray failed to start after 3 attempts. Watchdog suspended for Xray.")
            else:
                backend.watchdog_state.consecutive_xray_restarts = 0
                
        # Hysteria 2 core check
        if hysteria_inbound_ids:
            # Check if there are active clients for hysteria inbounds
            has_active_clients = False
            for ib_id in hysteria_inbound_ids:
                clients = get_clients_for_inbound(ib_id)
                if any(c["enable"] for c in clients):
                    has_active_clients = True
                    break
                    
            if has_active_clients:
                if not is_hysteria_running():
                    if backend.watchdog_state.consecutive_hysteria_restarts < 3:
                        backend.watchdog_state.consecutive_hysteria_restarts += 1
                        logging.warning(f"[Watchdog] Hysteria 2 is dead but active inbounds exist. Restarting (attempt {backend.watchdog_state.consecutive_hysteria_restarts}/3)...")
                        restart_hysteria()
                    else:
                        logging.error("[Watchdog] Hysteria 2 failed to start after 3 attempts. Watchdog suspended for Hysteria 2.")
                else:
                    backend.watchdog_state.consecutive_hysteria_restarts = 0
    finally:
        backend.watchdog_state.in_watchdog_context = False


def check_and_run_backups():
    from backend.database import get_setting, set_setting
    backup_enable = get_setting("backup_enable", "false") == "true"
    if not backup_enable:
        return
        
    backup_interval = get_setting("backup_interval", "daily")
    interval_seconds = 86400  # Default daily
    if backup_interval == "hourly":
        interval_seconds = 3600
    elif backup_interval == "weekly":
        interval_seconds = 604800
        
    last_backup = int(get_setting("last_backup_time", "0"))
    now_ts = int(time.time())
    
    if now_ts - last_backup >= interval_seconds:
        logging.info("[Backup Scheduler] Starting automated backup...")
        try:
            # 1. Run backup
            from backend.backup import create_backup_dump
            dump_data = create_backup_dump()
            
            # 2. Save locally
            from backend.config import BASE_DIR
            backups_dir = BASE_DIR / "backups"
            backups_dir.mkdir(parents=True, exist_ok=True)
            
            backup_filename = f"backup_{now_ts}.json"
            backup_file_path = backups_dir / backup_filename
            with open(backup_file_path, "w", encoding="utf-8") as f:
                f.write(dump_data)
            logging.info(f"[Backup Scheduler] Backup saved locally to {backup_file_path}")
            
            # 3. Rotate old backups
            try:
                rotation_limit = int(get_setting("backup_rotation", "7"))
            except ValueError:
                rotation_limit = 7
                
            backup_files = sorted(
                list(backups_dir.glob("backup_*.json")),
                key=lambda x: x.stat().st_mtime
            )
            while len(backup_files) > rotation_limit:
                oldest_file = backup_files.pop(0)
                try:
                    oldest_file.unlink()
                    logging.info(f"[Backup Scheduler] Deleted old backup file: {oldest_file.name}")
                except Exception as e:
                    logging.error(f"[Backup Scheduler] Failed to delete old backup file {oldest_file.name}: {e}")
                    
            # 4. Telegram notification/sending
            telegram_send = get_setting("backup_telegram", "false") == "true"
            if telegram_send:
                bot_token = get_setting("telegram_bot_token", "")
                admin_ids_str = get_setting("telegram_admin_ids", "")
                if bot_token and admin_ids_str:
                    admin_ids = [x.strip() for x in admin_ids_str.split(",") if x.strip()]
                    asyncio_send_backup_to_telegram(bot_token, admin_ids, str(backup_file_path), backup_filename)
                    
            # 5. Update last backup time
            set_setting("last_backup_time", str(now_ts))
            
        except Exception as e:
            logging.error(f"[Backup Scheduler] Automated backup failed: {e}")

def asyncio_send_backup_to_telegram(bot_token: str, admin_ids: list, file_path: str, filename: str):
    """Отправляет файл резервной копии администраторам в Telegram (асинхронно в фоне)"""
    try:
        from aiogram import Bot
        from aiogram.types import FSInputFile
        
        async def send_file_and_close(bot_inst, chat_id, path, fname):
            try:
                document = FSInputFile(path, filename=fname)
                await bot_inst.send_document(
                    chat_id=chat_id,
                    document=document,
                    caption=f"📁 <b>[Автоматический Бэкап]</b>\nСоздана автоматическая резервная копия базы данных.\nФайл: <code>{fname}</code>",
                    parse_mode="HTML"
                )
            except Exception as ex:
                logging.error(f"[Backup Scheduler] Failed to send document to {chat_id}: {ex}")
            finally:
                await bot_inst.session.close()
                
        loop = asyncio.get_running_loop()
        for admin_id in admin_ids:
            bot = Bot(token=bot_token)
            loop.create_task(send_file_and_close(bot, admin_id, file_path, filename))
    except RuntimeError:
        # Loop not running
        pass
    except Exception as e:
        logging.error(f"[Backup Scheduler] Failed to schedule Telegram sending: {e}")

import os
import sys
import logging
import asyncio
import requests
import time
import datetime
from aiogram import Bot, Dispatcher, html, F
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo, BufferedInputFile
from aiogram.filters import CommandStart, Command
from pathlib import Path

# Добавляем корневую папку в sys.path, чтобы импортировать config и i18n
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(BASE_DIR))

try:
    from backend.config import settings
except ImportError:
    class MockSettings:
        PANEL_PORT = 2053
        PANEL_SECRET_PATH = "ui"
        TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
        TELEGRAM_ADMIN_IDS = os.getenv("TELEGRAM_ADMIN_IDS", "")
    settings = MockSettings()

from backend.i18n import t

# Настройка логирования
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

# Получение публичного IP-адреса сервера
def get_public_ip():
    try:
        response = requests.get("https://api.ipify.org?format=json", timeout=5)
        if response.status_code == 200:
            return response.json().get("ip", "127.0.0.1")
    except Exception as e:
        logging.warning(f"Could not determine public IP: {e}")
    return "127.0.0.1"

# Проверка белого списка администраторов
def is_admin(user_id: int) -> bool:
    try:
        from backend.database import get_setting
        tg_admin_ids = get_setting("telegram_admin_ids", "")
    except Exception:
        tg_admin_ids = ""
    allowed_ids = [x.strip() for x in tg_admin_ids.split(",") if x.strip()]
    if not allowed_ids:
        return False
    return str(user_id) in allowed_ids

# Инициализация бота
try:
    from backend.database import get_setting
    bot_token = get_setting("telegram_bot_token", "")
except Exception:
    bot_token = ""

if not bot_token:
    logging.warning("TELEGRAM_BOT_TOKEN не задан ни в БД, ни в .env. Бот не запустится.")
    bot = None
    dp = None
else:
    bot = Bot(token=bot_token)
    dp = Dispatcher()

# Обработчики
if dp:
    @dp.message(CommandStart())
    @dp.message(Command("panel"))
    async def cmd_start(message: Message):
        user_id = message.from_user.id
        lang = message.from_user.language_code or "ru"
        
        if not is_admin(user_id):
            await message.reply(t("access_denied", lang, "bot"))
            logging.warning(f"Unauthorized Telegram access attempt from ID {user_id}")
            return
            
        public_ip = get_public_ip()
        port = settings.PANEL_PORT
        secret_path = settings.PANEL_SECRET_PATH
        
        webapp_url = f"http://{public_ip}:{port}/{secret_path}/"
        if port == 443:
            webapp_url = f"https://{public_ip}/{secret_path}/"
            
        markup = InlineKeyboardMarkup(inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=t("btn_open_webapp", lang, "bot"), 
                    web_app=WebAppInfo(url=webapp_url)
                )
            ]
        ])
        
        await message.reply(
            t("welcome_admin", lang, "bot", name=html.escape(message.from_user.full_name)),
            reply_markup=markup,
            parse_mode="HTML"
        )

    @dp.message(Command("backup"))
    async def cmd_backup(message: Message):
        user_id = message.from_user.id
        lang = message.from_user.language_code or "ru"
        
        if not is_admin(user_id):
            await message.reply(t("access_denied_general", lang, "bot"))
            return
            
        try:
            from backend.backup import create_backup_dump
            dump_data = create_backup_dump()
            
            file_data = dump_data.encode("utf-8")
            document = BufferedInputFile(file_data, filename=f"vpn_backup_{int(time.time())}.json")
            await message.reply_document(document, caption=t("backup_sent", lang, "bot"))
        except Exception as e:
            logging.error(f"Failed to create backup via bot: {e}")
            await message.reply(t("backup_error", lang, "bot", error=str(e)))

    @dp.message(Command("status"))
    async def cmd_status(message: Message):
        user_id = message.from_user.id
        lang = message.from_user.language_code or "ru"
        
        if not is_admin(user_id):
            await message.reply(t("access_denied_general", lang, "bot"))
            return
            
        try:
            from backend.host_client import host_client
            stats = host_client.send_command("get_system_stats")
            
            from backend.database import db_session
            from backend.models import ClientStats, Inbound
            
            with db_session() as session:
                total_inbounds = session.query(Inbound).count()
                total_clients = session.query(ClientStats).count()
                active_clients = session.query(ClientStats).filter_by(enable=1).count()
                blocked_clients = total_clients - active_clients
                
            cpu = stats.get("cpu", 0.0)
            mem = stats.get("mem", {})
            mem_curr = mem.get("current", 0) / (1024**3)
            mem_tot = mem.get("total", 0) / (1024**3)
            uptime = stats.get("uptime", 0)
            
            # Аптайм перевод
            days = uptime // 86400
            hours = (uptime % 86400) // 3600
            minutes = (uptime % 3600) // 60
            
            uptime_days_unit = t("uptime_days", lang, "bot")
            uptime_hours_unit = t("uptime_hours", lang, "bot")
            uptime_minutes_unit = t("uptime_minutes", lang, "bot")
            uptime_str = f"{days}{uptime_days_unit} {hours}{uptime_hours_unit} {minutes}{uptime_minutes_unit}"
            
            msg = (
                f"📊 <b>{t('status_title', lang, 'bot')}</b>\n"
                f"━━━━━━━━━━━━━━━━━━━━━━━━\n"
                f"🖥️ {t('status_cpu', lang, 'bot')}: <b>{cpu}%</b>\n"
                f"💾 {t('status_memory', lang, 'bot')}: <b>{mem_curr:.2f} GB / {mem_tot:.2f} GB</b>\n"
                f"⏱ {t('status_uptime', lang, 'bot')}: <b>{uptime_str}</b>\n"
                f"━━━━━━━━━━━━━━━━━━━━━━━━\n"
                f"🖧 {t('status_inbounds', lang, 'bot')}: <b>{total_inbounds}</b>\n"
                f"👥 {t('status_total_clients', lang, 'bot')}: <b>{total_clients}</b>\n"
                f"🟢 {t('status_active_clients', lang, 'bot')}: <b>{active_clients}</b>\n"
                f"🔴 {t('status_blocked_clients', lang, 'bot')}: <b>{blocked_clients}</b>"
            )
            await message.reply(msg, parse_mode="HTML")
        except Exception as e:
            logging.error(f"Failed to get status via bot: {e}")
            await message.reply(t("status_error", lang, "bot", error=str(e)))

    @dp.message(Command("my"))
    async def cmd_my(message: Message):
        user_id = message.from_user.id
        lang = message.from_user.language_code or "ru"
        
        if not is_admin(user_id):
            await message.reply(t("access_denied_general", lang, "bot"))
            return
            
        args = message.text.split(maxsplit=1)
        if len(args) < 2:
            await message.reply(t("my_help", lang, "bot"), parse_mode="HTML")
            return
            
        search_key = args[1].strip()
        
        try:
            from backend.database import db_session
            from backend.models import ClientStats, Inbound
            from backend.links_generator import get_client_links
            
            found_clients = []
            with db_session() as session:
                clients = session.query(ClientStats).filter(
                    (ClientStats.email == search_key) | (ClientStats.client_uuid_or_pwd == search_key)
                ).all()
                for c in clients:
                    ib = session.query(Inbound).filter_by(id=c.inbound_id).first()
                    if ib:
                        c_dict = {
                            "id": c.id, "inbound_id": c.inbound_id, "email": c.email,
                            "client_uuid_or_pwd": c.client_uuid_or_pwd, "up": c.up, "down": c.down,
                            "total": c.total, "expiry_time": c.expiry_time, "enable": c.enable,
                            "limit_ip": c.limit_ip, "block_reason": c.block_reason or ""
                        }
                        ib_dict = {
                            "id": ib.id, "remark": ib.remark, "port": ib.port, "protocol": ib.protocol,
                            "settings": ib.settings, "stream_settings": ib.stream_settings, "sniffing": ib.sniffing,
                            "enable": ib.enable, "up": ib.up, "down": ib.down, "total": ib.total, "expiry_time": ib.expiry_time
                        }
                        found_clients.append((ib_dict, c_dict))
                        
            if not found_clients:
                await message.reply(t("my_not_found", lang, "bot"))
                return
                
            public_ip = get_public_ip()
            port = settings.PANEL_PORT
            base_url = f"http://{public_ip}:{port}"
            
            for ib, c in found_clients:
                up_gb = c["up"] / (1024**3)
                down_gb = c["down"] / (1024**3)
                total_gb = c["total"] / (1024**3) if c["total"] > 0 else t("unlimited", lang, "bot")
                total_gb_str = f"{total_gb:.2f} GB" if isinstance(total_gb, float) else total_gb
                
                if c["enable"] == 1:
                    status_str = f"🟢 {t('active', lang, 'bot')}"
                else:
                    reason = c['block_reason'] or t('limits_exceeded', lang, 'bot')
                    status_str = f"🔴 {t('blocked', lang, 'bot')} ({reason})"
                
                exp_str = t("never_expires", lang, "bot")
                if c["expiry_time"] > 0:
                    dt = datetime.datetime.fromtimestamp(c["expiry_time"] / 1000)
                    exp_str = dt.strftime("%Y-%m-%d %H:%M:%S")
                    
                msg = (
                    f"🔑 <b>{t('sub_title', lang, 'bot', email=html.escape(c['email']))}</b>\n"
                    f"━━━━━━━━━━━━━━━━━━━━━━━━\n"
                    f"📌 {t('sub_inbound', lang, 'bot')}: <b>{ib['remark']} (:{ib['port']})</b>\n"
                    f"📡 {t('sub_proto', lang, 'bot')}: <b>{ib['protocol'].upper()}</b>\n"
                    f"🚦 {t('sub_downloaded', lang, 'bot')}: <b>{down_gb:.3f} GB</b>\n"
                    f"📤 {t('sub_uploaded', lang, 'bot')}: <b>{up_gb:.3f} GB</b>\n"
                    f"💾 {t('sub_limit', lang, 'bot')}: <b>{total_gb_str}</b>\n"
                    f"⏱ {t('sub_expires', lang, 'bot')}: <b>{exp_str}</b>\n"
                    f"⚡ {t('sub_status', lang, 'bot')}: <b>{status_str}</b>\n"
                    f"━━━━━━━━━━━━━━━━━━━━━━━━\n"
                    f"🔗 {t('sub_keys', lang, 'bot')}\n"
                )
                
                links = get_client_links(ib, c, base_url)
                for link in links:
                    msg += f"<code>{html.escape(link)}</code>\n\n"
                    
                msg += f"{t('sub_click_to_copy', lang, 'bot')}"
                await message.reply(msg, parse_mode="HTML")
                
        except Exception as e:
            logging.error(f"Error checking sub info in bot: {e}")
            await message.reply(t("my_error", lang, "bot", error=str(e)))

async def main():
    if not bot:
        print("Telegram Bot Token не задан. Бот запущен не будет.")
        return
        
    logging.info("Starting Telegram Mini Bot...")
    await dp.start_polling(bot)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logging.info("Bot stopped.")

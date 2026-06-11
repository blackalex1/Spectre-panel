import asyncio
import logging
import httpx
from backend.database import get_setting

async def get_geoip_info(ip: str) -> str:
    """
    Определяет геолокацию по IP-адресу через публичный API ip-api.com.
    Игнорирует локальные и некорректные IP-адреса.
    """
    if not ip or ip == "unknown" or ip.startswith("127.") or ip.startswith("192.168.") or ip.startswith("10.") or ip.startswith("172.16."):
        return "Локальная сеть"
        
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get(f"http://ip-api.com/json/{ip}")
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "success":
                    country = data.get("country", "")
                    city = data.get("city", "")
                    org = data.get("org", "")
                    geo_parts = []
                    if country:
                        geo_parts.append(country)
                    if city:
                        geo_parts.append(city)
                    if org:
                        geo_parts.append(f"ISP: {org}")
                    return " - ".join(geo_parts) if geo_parts else "Определено"
    except Exception as e:
        logging.warning(f"[GeoIP] Не удалось получить данные для {ip}: {e}")
    return "Неизвестно"

async def async_send_telegram_alert(username: str, action: str, target: str, details: str):
    """
    Форматирует и отправляет сообщение в Telegram для администраторов.
    """
    bot_token = get_setting("telegram_bot_token", "")
    admin_ids_str = get_setting("telegram_admin_ids", "")
    if not bot_token or not admin_ids_str:
        return
        
    admin_ids = [x.strip() for x in admin_ids_str.split(",") if x.strip()]
    if not admin_ids:
        return

    text = ""
    if action in ("login_success", "login_telegram_success"):
        geoip = await get_geoip_info(target)
        emoji = "🟢" if action == "login_success" else "🔵"
        auth_type = "Пароль" if action == "login_success" else "Telegram WebApp"
        text = (
            f"{emoji} <b>Успешный вход в панель!</b>\n\n"
            f"👤 Пользователь: <code>{username}</code>\n"
            f"🌐 IP: <code>{target}</code>\n"
            f"🗺️ Гео: <b>{geoip}</b>\n"
            f"🔑 Метод: <i>{auth_type}</i>"
        )
    elif action == "login_rate_limited":
        text = (
            f"⚠️ <b>Внимание: Обнаружен Brute-force!</b>\n\n"
            f"🔴 IP <code>{target}</code> временно заблокирован из-за превышения лимита попыток входа.\n"
            f"ℹ️ Детали: <i>{details}</i>"
        )
        
    if not text:
        return
        
    # Отправляем сообщение асинхронно
    async with httpx.AsyncClient(timeout=5.0) as client:
        for admin_id in admin_ids:
            try:
                url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
                payload = {
                    "chat_id": admin_id,
                    "text": text,
                    "parse_mode": "HTML"
                }
                await client.post(url, json=payload)
            except Exception as e:
                logging.error(f"[Telegram Alert] Не удалось отправить сообщение администратору {admin_id}: {e}")

def trigger_telegram_alert(username: str, action: str, target: str = None, details: str = None):
    """
    Запускает отправку алерта в фоновой задаче, чтобы не блокировать текущий запрос.
    """
    if action not in ("login_success", "login_telegram_success", "login_rate_limited"):
        return
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(async_send_telegram_alert(username, action, target, details))
    except RuntimeError:
        # Если цикл не запущен (например, при тестировании или старте из CLI)
        pass


async def _send_alert_to_all_admins(text: str):
    """Отправляет HTML-сообщение всем администраторам через Telegram Bot API."""
    bot_token = get_setting("telegram_bot_token", "")
    admin_ids_str = get_setting("telegram_admin_ids", "")
    if not bot_token or not admin_ids_str:
        return
        
    admin_ids = [x.strip() for x in admin_ids_str.split(",") if x.strip()]
    if not admin_ids:
        return

    async with httpx.AsyncClient(timeout=5.0) as client:
        for admin_id in admin_ids:
            try:
                url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
                payload = {
                    "chat_id": admin_id,
                    "text": text,
                    "parse_mode": "HTML"
                }
                await client.post(url, json=payload)
            except Exception as e:
                logging.error(f"[Telegram Alert] Не удалось отправить сообщение администратору {admin_id}: {e}")


def trigger_investigation_result_alert(culprit: str, tunnel: str, node_id: str, details: str):
    """✅ Telegram-алерт: edge-нода успешно расследовала инцидент."""
    text = (
        f"✅ <b>[IPS: Расследование от Edge-ноды завершено]</b>\n\n"
        f"🔍 Нода: <code>{node_id}</code>\n"
        f"👤 Нарушитель заблокирован глобально: <code>{culprit}</code>\n"
        f"🔓 Инбаунд/туннель разблокирован: <code>{tunnel}</code>\n"
        f"📋 Детали: <i>{details}</i>"
    )
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_send_alert_to_all_admins(text))
    except RuntimeError:
        pass


def trigger_investigation_failed_alert(tunnel: str, node_id: str, details: str):
    """⚠️ Telegram-алерт: расследование на edge-ноде не удалось, нужно ручное вмешательство."""
    text = (
        f"⚠️ <b>[IPS: Расследование не удалось (Edge-нода)]</b>\n\n"
        f"🔍 Нода: <code>{node_id}</code>\n"
        f"🚨 Инбаунд оставлен в бане: <code>{tunnel}</code>\n"
        f"📋 Детали: <i>{details}</i>\n\n"
        f"👇 <b>Разблокируйте инбаунд вручную</b>, когда проведёте расследование самостоятельно."
    )
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_send_alert_to_all_admins(text))
    except RuntimeError:
        pass

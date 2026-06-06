@echo off
chcp 65001 > nul
echo [+] Проверка виртуального окружения...
if not exist .venv (
    echo [!] Виртуальное окружение не найдено. Создание...
    python -m venv .venv
)

echo [+] Установка и проверка зависимостей...
call .venv\Scripts\activate.bat
pip install -r requirements.txt

echo [+] Запуск Spectre Panel на случайном порту...
start "Spectre Panel Server" cmd /k ".venv\Scripts\python backend\main.py"

echo [+] Запуск Telegram-бота управления...
start "Spectre Telegram Bot" cmd /k ".venv\Scripts\python bot\mini_bot.py"

echo [+] Сервисы запущены. Проверьте новые окна консоли.
pause

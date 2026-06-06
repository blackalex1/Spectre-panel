#!/bin/bash

# Ensure script is run as root
if [ "$EUID" -ne 0 ]; then
  echo "[!] Please run as root (use sudo)"
  exit 1
fi

echo "===================================================="
echo "⚠️  WARNING: COMPLETE RESET OF VPN PANEL"
echo "===================================================="
echo "This script will completely erase:"
echo " 1. All PostgreSQL database data (users, clients, history)"
echo " 2. All configuration settings and Telegram tokens (config/.env)"
echo " 3. Host agent service configurations"
echo " 4. Docker images and volumes"
echo "----------------------------------------------------"
read -p "Are you absolutely sure you want to proceed? (y/N): " CONFIRM

if [[ ! "$CONFIRM" =~ ^[yY]$ ]]; then
    echo "Reset cancelled."
    exit 0
fi

echo "[+] Stopping Docker containers and removing volumes/images..."
docker compose down -v --rmi all --remove-orphans

echo "[+] Stopping and disabling vpn-host-agent service..."
systemctl stop vpn-host-agent 2>/dev/null
systemctl disable vpn-host-agent 2>/dev/null
rm -f /etc/systemd/system/vpn-host-agent.service
systemctl daemon-reload

echo "[+] Deleting configurations and database files..."
rm -f config/.env
rm -f panel.db test_panel.db
rm -rf /var/run/vpn_panel

echo "[+] Cleanup complete!"
echo "===================================================="
read -p "Would you like to start a clean installation now? (y/N): " START_INSTALL

if [[ "$START_INSTALL" =~ ^[yY]$ ]]; then
    if [ -f "./install.sh" ]; then
        chmod +x ./install.sh
        ./install.sh
    else
        echo "[!] install.sh not found in the current directory."
    fi
else
    echo "Done. You can start the installation later using: sudo ./install.sh"
fi

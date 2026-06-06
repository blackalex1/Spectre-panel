import { apiFetch } from "../api.js";
import { showToast } from "../ui.js";
import { t } from "../i18n.js";
import { loadHysteriaConfig } from "./hysteria-config.js";

export async function loadHysteriaCoreInfo() {
    const res = await apiFetch("/api/hysteria/version");
    if (!res || !res.success) return;
    
    const currEl = document.getElementById("hysteria-curr-version");
    const latestEl = document.getElementById("hysteria-latest-version");
    if (currEl) currEl.innerText = res.current;
    if (latestEl) latestEl.innerText = res.latest;
    
    const updateBtn = document.getElementById("hysteria-update-btn");
    if (updateBtn) {
        if (res.current !== res.latest && res.latest !== "Unknown" && res.download_url) {
            updateBtn.disabled = false;
            updateBtn.setAttribute("data-url", res.download_url);
            updateBtn.innerHTML = `<i class="fa-solid fa-download"></i> <span>${t("hysteria_btn_update", "Обновить ядро")}</span>`;
        } else {
            updateBtn.disabled = true;
            updateBtn.innerText = t("hysteria_updated", "Обновлено");
        }
    }
    
    // Получаем текущий статус запущенности Hysteria и настраиваем кнопку Остановить/Запустить
    const statusRes = await apiFetch("/api/hysteria/status");
    const stopBtn = document.getElementById("hysteria-stop-btn");
    if (statusRes && stopBtn) {
        if (statusRes.running) {
            stopBtn.className = "btn danger-btn";
            stopBtn.innerHTML = `<i class="fa-solid fa-stop"></i> <span>${t("hysteria_btn_stop", "Остановить")}</span>`;
            stopBtn.setAttribute("data-action", "stop");
        } else {
            stopBtn.className = "btn success-btn";
            stopBtn.innerHTML = `<i class="fa-solid fa-play"></i> <span>${t("hysteria_btn_start", "Запустить")}</span>`;
            stopBtn.setAttribute("data-action", "start");
        }
    }
    
    await loadHysteriaConfig();
}

let lastHysteriaLogsStr = "";

export async function loadHysteriaLogs() {
    const res = await apiFetch("/api/hysteria/logs");
    if (!res || !res.success) return;
    
    const terminal = document.getElementById("hysteria-logs-terminal");
    if (terminal) {
        const logsStr = JSON.stringify(res.logs);
        if (logsStr === lastHysteriaLogsStr) {
            return;
        }
        lastHysteriaLogsStr = logsStr;
        
        const currentScroll = terminal.scrollTop + terminal.clientHeight >= terminal.scrollHeight - 50;
        
        terminal.innerHTML = "";
        res.logs.forEach(line => {
            const div = document.createElement("div");
            div.innerText = line;
            
            // Цветовая разметка логов
            if (line.toLowerCase().includes("warn") || line.includes("[Warning]")) {
                div.style.color = "var(--accent-orange)";
            } else if (line.toLowerCase().includes("err") || line.includes("[Error]")) {
                div.style.color = "var(--accent-rose)";
            } else if (line.includes("connected") || line.includes("authenticate")) {
                div.style.color = "var(--accent-blue)";
            }
            
            terminal.appendChild(div);
        });
        
        if (currentScroll) {
            terminal.scrollTop = terminal.scrollHeight;
        }
    }
}

export function setupHysteriaCoreListeners() {
    const clearLogsBtn = document.getElementById("hysteria-clear-logs-btn");
    if (clearLogsBtn) {
        clearLogsBtn.addEventListener("click", async () => {
            const res = await apiFetch("/api/hysteria/logs/clear", { method: "POST" });
            if (res && res.success) {
                lastHysteriaLogsStr = "[]";
                const terminal = document.getElementById("hysteria-logs-terminal");
                if (terminal) terminal.innerText = "";
                showToast(t("logs_cleared", "Логи очищены"));
            } else {
                showToast(t("logs_clear_error", "Ошибка при очистке логов"), "error");
            }
        });
    }

    const copyLogsBtn = document.getElementById("hysteria-copy-logs-btn");
    if (copyLogsBtn) {
        copyLogsBtn.addEventListener("click", () => {
            const terminal = document.getElementById("hysteria-logs-terminal");
            if (terminal) {
                const text = terminal.innerText;
                navigator.clipboard.writeText(text).then(() => {
                    showToast(t("logs_copied", "Логи скопированы в буфер обмена"));
                }).catch(err => {
                    showToast(t("logs_copy_error", "Не удалось скопировать логи"), "error");
                });
            }
        });
    }
    
    const restartBtn = document.getElementById("hysteria-restart-btn");
    if (restartBtn) {
        restartBtn.addEventListener("click", async () => {
            const res = await apiFetch("/api/hysteria/action", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "restart" })
            });
            if (res && res.success) {
                showToast(t("hysteria_restarted", "Ядро Hysteria перезапущено"));
                loadHysteriaCoreInfo();
            }
        });
    }
    
    const stopBtn = document.getElementById("hysteria-stop-btn");
    if (stopBtn) {
        stopBtn.addEventListener("click", async () => {
            const action = stopBtn.getAttribute("data-action") || "stop";
            const res = await apiFetch("/api/hysteria/action", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: action })
            });
            if (res && res.success) {
                if (action === "stop") {
                    showToast(t("hysteria_stopped_toast", "Ядро Hysteria остановлено"), "info");
                } else {
                    showToast(t("hysteria_started_toast", "Ядро Hysteria запущено"));
                }
                loadHysteriaCoreInfo();
            }
        });
    }
    
    const updateBtn = document.getElementById("hysteria-update-btn");
    if (updateBtn) {
        updateBtn.addEventListener("click", async () => {
            const url = updateBtn.getAttribute("data-url");
            if (!url) return;
            
            updateBtn.disabled = true;
            updateBtn.innerText = t("hysteria_updating", "Обновление...");
            showToast(t("hysteria_update_started", "Начался процесс обновления ядра Hysteria. Пожалуйста, подождите"), "info");
            
            const res = await apiFetch("/api/hysteria/update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ download_url: url })
            });
            
            if (res && res.success) {
                showToast(t("hysteria_update_success", "Ядро успешно обновлено до версии {version}!").replace("{version}", res.version));
                loadHysteriaCoreInfo();
            } else {
                showToast(res ? res.msg : t("hysteria_update_error", "Ошибка обновления ядра"), "error");
                loadHysteriaCoreInfo();
            }
        });
    }
}

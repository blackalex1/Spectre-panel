import { apiFetch } from "../../api.js";
import { showToast } from "../../ui.js";
import { t } from "../../i18n.js";
import { loadXrayConfig } from "./config.js";

export async function loadCoreInfo() {
    const res = await apiFetch("/api/xray/version");
    if (!res || !res.success) return;
    
    document.getElementById("core-curr-version").innerText = res.current;
    document.getElementById("core-latest-version").innerText = res.latest;
    
    const updateBtn = document.getElementById("core-update-btn");
    if (res.current !== res.latest && res.latest !== "Unknown" && res.download_url) {
        updateBtn.disabled = false;
        updateBtn.setAttribute("data-url", res.download_url);
    } else {
        updateBtn.disabled = true;
        updateBtn.innerText = t("xray_updated", "Обновлено");
    }
    
    const statusRes = await apiFetch("/api/xray/status");
    if (statusRes) {
        const stopBtn = document.getElementById("core-stop-btn");
        if (stopBtn) {
            if (statusRes.running) {
                stopBtn.className = "btn danger-btn";
                stopBtn.innerHTML = `<i class="fa-solid fa-stop"></i> <span>${t("xray_btn_stop", "Остановить")}</span>`;
                stopBtn.setAttribute("data-action", "stop");
            } else {
                stopBtn.className = "btn success-btn";
                stopBtn.innerHTML = `<i class="fa-solid fa-play"></i> <span>${t("xray_btn_start", "Запустить")}</span>`;
                stopBtn.setAttribute("data-action", "start");
            }
        }
        
        // Update top-bar badge
        const badge = document.getElementById("xray-status-badge");
        const statusText = badge ? badge.querySelector(".status-text") : null;
        if (badge && statusText) {
            if (statusRes.running) {
                badge.className = "status-badge running";
                statusText.innerText = t("xray_status_active", "Xray: Активен");
            } else {
                badge.className = "status-badge stopped";
                statusText.innerText = t("xray_status_stopped", "Xray: Остановлен");
            }
        }
    }
    
    await loadXrayConfig();
}

let lastXrayLogsStr = "";

export async function loadLogs() {
    const res = await apiFetch("/api/xray/logs");
    if (!res || !res.success) return;
    
    const terminal = document.getElementById("logs-terminal");
    if (terminal) {
        const logsStr = JSON.stringify(res.logs);
        if (logsStr === lastXrayLogsStr) {
            return;
        }
        lastXrayLogsStr = logsStr;
        
        const currentScroll = terminal.scrollTop + terminal.clientHeight >= terminal.scrollHeight - 50;
        
        terminal.innerHTML = "";
        res.logs.forEach(line => {
            const div = document.createElement("div");
            div.innerText = line;
            
            if (line.includes("[Warning]")) div.style.color = "var(--accent-orange)";
            else if (line.includes("[Error]")) div.style.color = "var(--accent-rose)";
            else if (line.includes("api:")) div.style.color = "var(--accent-blue)";
            
            terminal.appendChild(div);
        });
        
        if (currentScroll) {
            terminal.scrollTop = terminal.scrollHeight;
        }
    }
}

export function setupXrayCoreListeners() {
    const restartBtn = document.getElementById("core-restart-btn");
    if (restartBtn) {
        restartBtn.addEventListener("click", async () => {
            const res = await apiFetch("/api/xray/action", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "restart" })
            });
            if (res && res.success) showToast(t("xray_restarted", "Ядро Xray перезапущено"));
        });
    }
    
    const coreStopBtn = document.getElementById("core-stop-btn");
    if (coreStopBtn) {
        coreStopBtn.addEventListener("click", async () => {
            const action = coreStopBtn.getAttribute("data-action") || "stop";
            const res = await apiFetch("/api/xray/action", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: action })
            });
            if (res && res.success) {
                if (action === "stop") {
                    showToast(t("xray_stopped_toast", "Ядро Xray остановлено"), "info");
                } else {
                    showToast(t("xray_started_toast", "Ядро Xray запущено"));
                }
                loadCoreInfo();
            }
        });
    }
    
    const updateBtn = document.getElementById("core-update-btn");
    if (updateBtn) {
        updateBtn.addEventListener("click", async () => {
            const url = updateBtn.getAttribute("data-url");
            if (!url) return;
            
            updateBtn.disabled = true;
            updateBtn.innerText = "Обновление...";
            showToast(t("xray_update_started", "Начался процесс обновления ядра Xray. Пожалуйста, подождите"), "info");
            
            const res = await apiFetch("/api/xray/update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ download_url: url })
            });
            
            if (res && res.success) {
                showToast(t("xray_update_success", "Ядро успешно обновлено до версии {version}!").replace("{version}", res.version));
                loadCoreInfo();
            } else {
                showToast(res ? res.msg : t("xray_update_error", "Ошибка обновления ядра"), "error");
                loadCoreInfo();
            }
        });
    }

    const clearLogsBtn = document.getElementById("clear-logs-btn");
    if (clearLogsBtn) {
        clearLogsBtn.addEventListener("click", async () => {
            const res = await apiFetch("/api/xray/logs/clear", { method: "POST" });
            if (res && res.success) {
                lastXrayLogsStr = "[]";
                const terminal = document.getElementById("logs-terminal");
                if (terminal) terminal.innerText = "";
                showToast(t("logs_cleared", "Логи очищены"));
            } else {
                showToast(t("logs_clear_error", "Ошибка при очистке логов"), "error");
            }
        });
    }

    const copyLogsBtn = document.getElementById("copy-logs-btn");
    if (copyLogsBtn) {
        copyLogsBtn.addEventListener("click", () => {
            const terminal = document.getElementById("logs-terminal");
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
}

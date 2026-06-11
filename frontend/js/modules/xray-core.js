import { apiFetch } from "../api.js";
import { showToast } from "../ui.js";
import { t } from "../i18n.js";
import { loadXrayConfig } from "./xray-config.js";

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

// --- Geo Files Management ---

export async function loadGeoInfo() {
    const res = await apiFetch("/api/xray/geo");
    if (!res || !res.success) return;

    const info = res.obj;

    // geoip.dat
    const geoipBadge = document.getElementById("geo-geoip-badge");
    const geoipMeta  = document.getElementById("geo-geoip-meta");
    if (geoipBadge && geoipMeta) {
        if (info["geoip.dat"] && info["geoip.dat"].exists) {
            geoipBadge.textContent = "✓ Установлен";
            geoipBadge.className = "tag-badge tag-badge-direct";
            geoipMeta.textContent = `${info["geoip.dat"].size_kb} КБ · Обновлён: ${info["geoip.dat"].updated_at}`;
        } else {
            geoipBadge.textContent = "✗ Отсутствует";
            geoipBadge.className = "tag-badge tag-badge-blocked";
            geoipMeta.textContent = "Файл не найден в папке bin/";
        }
    }

    // geosite.dat
    const geositeBadge = document.getElementById("geo-geosite-badge");
    const geositeMeta  = document.getElementById("geo-geosite-meta");
    if (geositeBadge && geositeMeta) {
        if (info["geosite.dat"] && info["geosite.dat"].exists) {
            geositeBadge.textContent = "✓ Установлен";
            geositeBadge.className = "tag-badge tag-badge-direct";
            geositeMeta.textContent = `${info["geosite.dat"].size_kb} КБ · Обновлён: ${info["geosite.dat"].updated_at}`;
        } else {
            geositeBadge.textContent = "✗ Отсутствует";
            geositeBadge.className = "tag-badge tag-badge-blocked";
            geositeMeta.textContent = "Файл не найден в папке bin/";
        }
    }

    // Заполняем поля URL (показываем только если не дефолтный)
    const geoipUrlInput   = document.getElementById("geo-geoip-url");
    const geositeUrlInput = document.getElementById("geo-geosite-url");

    if (geoipUrlInput) {
        // Храним дефолт в data-атрибуте для placeholder/сброса
        geoipUrlInput.setAttribute("data-default", info.geoip_url || "");
        geoipUrlInput.placeholder = info.geoip_url || "https://github.com/.../geoip.dat";
        // Показываем кастомный URL только если он отличается от дефолтного
        const savedGeoipUrl = geoipUrlInput.getAttribute("data-saved") || "";
        if (savedGeoipUrl && savedGeoipUrl !== info.geoip_url) {
            geoipUrlInput.value = savedGeoipUrl;
        }
    }
    if (geositeUrlInput) {
        geositeUrlInput.setAttribute("data-default", info.geosite_url || "");
        geositeUrlInput.placeholder = info.geosite_url || "https://github.com/.../geosite.dat";
        const savedGeositeUrl = geositeUrlInput.getAttribute("data-saved") || "";
        if (savedGeositeUrl && savedGeositeUrl !== info.geosite_url) {
            geositeUrlInput.value = savedGeositeUrl;
        }
    }
}

export function setupGeoListeners() {
    // --- Кнопка "Сохранить URL" ---
    const saveBtn = document.getElementById("geo-save-btn");
    if (saveBtn) {
        saveBtn.addEventListener("click", async () => {
            const geoipUrlEl = document.getElementById("geo-geoip-url");
            const geositeUrlEl = document.getElementById("geo-geosite-url");
            const geoipUrl   = (geoipUrlEl ? geoipUrlEl.value : "").trim();
            const geositeUrl = (geositeUrlEl ? geositeUrlEl.value : "").trim();

            // Базовая валидация
            for (const [label, url] of [["geoip_url", geoipUrl], ["geosite_url", geositeUrl]]) {
                if (url && !url.toLowerCase().endsWith(".dat")) {
                    showToast(t("geo_err_dat", `${label}: URL должен заканчиваться на .dat`), "warning");
                    return;
                }
            }

            const res = await apiFetch("/api/xray/geo/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ geoip_url: geoipUrl, geosite_url: geositeUrl })
            });

            if (res && res.success) {
                // Сохраняем как data-saved для последующей загрузки
                const geoipUrlInput = document.getElementById("geo-geoip-url");
                const geositeUrlInput = document.getElementById("geo-geosite-url");
                if (geoipUrlInput) geoipUrlInput.setAttribute("data-saved", geoipUrl);
                if (geositeUrlInput) geositeUrlInput.setAttribute("data-saved", geositeUrl);
                showToast(t("geo_saved", "URL источников geo-файлов сохранены"));
                await loadGeoInfo();
            } else {
                showToast(res ? res.msg : t("geo_save_error", "Ошибка сохранения URL"), "error");
            }
        });
    }

    // --- Кнопка "Сбросить URL к дефолтным" ---
    const resetBtn = document.getElementById("geo-reset-btn");
    if (resetBtn) {
        resetBtn.addEventListener("click", async () => {
            const geoipInput   = document.getElementById("geo-geoip-url");
            const geositeInput = document.getElementById("geo-geosite-url");
            if (geoipInput)   geoipInput.value = "";
            if (geositeInput) geositeInput.value = "";

            const res = await apiFetch("/api/xray/geo/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ geoip_url: "", geosite_url: "" })
            });

            if (res && res.success) {
                showToast(t("geo_reset", "URL сброшены к дефолтным (Loyalsoldier)"));
                await loadGeoInfo();
            } else {
                showToast(res ? res.msg : "Ошибка сброса URL", "error");
            }
        });
    }

    // --- Кнопка "Обновить geo-файлы" ---
    const updateBtn   = document.getElementById("geo-update-btn");
    const statusSpan  = document.getElementById("geo-update-status");

    if (updateBtn) {
        updateBtn.addEventListener("click", async () => {
            updateBtn.disabled = true;
            const origHtml = updateBtn.innerHTML;
            updateBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin" style="margin-right:6px;"></i><span>${t("geo_updating", "Скачивание...")}</span>`;

            if (statusSpan) {
                statusSpan.textContent = "⏳ Скачивание файлов...";
                statusSpan.style.display = "inline";
                statusSpan.style.color = "var(--text-secondary)";
            }

            showToast(t("geo_update_started", "Начато скачивание geo-файлов, пожалуйста подождите..."), "info");

            const res = await apiFetch("/api/xray/geo/update", { method: "POST" });

            updateBtn.disabled = false;
            updateBtn.innerHTML = origHtml;

            if (res && (res.success || res.partial)) {
                if (statusSpan) {
                    statusSpan.textContent = `✓ ${res.msg}`;
                    statusSpan.style.color = "var(--accent-teal, #2ed573)";
                    statusSpan.style.display = "inline";
                }
                showToast(
                    res.success
                        ? t("geo_update_success", "Geo-файлы успешно обновлены! Xray перезапущен.")
                        : t("geo_update_partial", `Частично обновлено: ${res.msg}`),
                    res.success ? "success" : "warning"
                );
                // Обновляем статус-карточки с новыми данными
                if (res.info) {
                    _applyGeoInfoToUI(res.info);
                } else {
                    await loadGeoInfo();
                }
            } else {
                if (statusSpan) {
                    statusSpan.textContent = `✗ ${(res && res.msg) || "Ошибка"}`;
                    statusSpan.style.color = "var(--accent-rose, #ff4757)";
                    statusSpan.style.display = "inline";
                }
                showToast(res ? res.msg : t("geo_update_error", "Ошибка обновления geo-файлов"), "error");
            }
        });
    }
}

/** Вспомогательная функция: применяет данные geo-файлов к UI без доп. запроса */
function _applyGeoInfoToUI(info) {
    const files = [
        { key: "geoip.dat",   badgeId: "geo-geoip-badge",   metaId: "geo-geoip-meta"   },
        { key: "geosite.dat", badgeId: "geo-geosite-badge",  metaId: "geo-geosite-meta" },
    ];
    for (const { key, badgeId, metaId } of files) {
        const badge = document.getElementById(badgeId);
        const meta  = document.getElementById(metaId);
        if (!badge || !meta) continue;
        const f = info[key];
        if (f && f.exists) {
            badge.textContent = "✓ Установлен";
            badge.className = "tag-badge tag-badge-direct";
            meta.textContent = `${f.size_kb} КБ · Обновлён: ${f.updated_at}`;
        } else {
            badge.textContent = "✗ Отсутствует";
            badge.className = "tag-badge tag-badge-blocked";
            meta.textContent = "Файл не найден в папке bin/";
        }
    }
}

import { apiFetch } from "../../api.js";
import { showToast } from "../../ui.js";
import { t, translatePage } from "../../i18n.js";

export async function loadXrayConfig() {
    const res = await apiFetch("/api/xray/config");
    if (!res || !res.success) return;
    
    window.xrayConfig = res.config;
    const config = window.xrayConfig;
    
    // Fill Raw JSON
    const rawPre = document.getElementById("xray-config-raw-pre");
    if (rawPre) {
        rawPre.value = JSON.stringify(config, null, 2);
    }
    
    // Parse & Render Structure
    const parsedContainer = document.getElementById("xray-config-parsed-container");
    if (!parsedContainer) return;
    
    let html = "";
    
    // -- 1. LOGGING & GLOBAL SETTINGS --
    if (config.log) {
        html += `<div style="margin-bottom: 25px;">
            <h4 style="margin-top: 0; margin-bottom: 12px; font-size: 15px; font-weight: 600; color: var(--accent-orange); display: flex; align-items: center; gap: 8px; width: 100%;">
                <i class="fa-solid fa-file-invoice"></i> <span data-i18n="xray_config_logging">Системные настройки и логирование</span>
                <button class="btn secondary-btn edit-json-btn" data-type="xray-log" style="margin-left: auto; padding: 4px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; height: auto;"><i class="fa-regular fa-pen-to-square"></i> JSON</button>
            </h4>
            <div class="glass-card" style="padding: 15px; border-radius: 10px; background: rgba(255,255,255,0.015);">
                <div style="font-size: 13px; line-height: 1.6; color: var(--text-secondary);">
                    <div>LogLevel: <span class="badge active" style="font-size: 11px; background: rgba(255, 165, 2, 0.15); color: #ffa502; border: 1px solid rgba(255, 165, 2, 0.3); padding: 2px 6px;">${config.log.loglevel || "warning"}</span></div>
                    <div style="margin-top: 5px;">Access Log: <code style="font-size: 11px; word-break: break-all; color: var(--text-primary);">${config.log.access || "—"}</code></div>
                    <div style="margin-top: 5px;">Error Log: <code style="font-size: 11px; word-break: break-all; color: var(--text-primary);">${config.log.error || "—"}</code></div>
                </div>
            </div>
        </div>`;
    }
    
    // -- 2. INBOUNDS --
    html += `<div style="margin-bottom: 25px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 10px;">
            <h4 style="margin: 0; font-size: 15px; font-weight: 600; color: var(--accent-blue); display: flex; align-items: center; gap: 8px;">
                <i class="fa-solid fa-arrow-right-to-bracket"></i> <span data-i18n="xray_config_inbounds">Входящие подключения (Inbounds)</span>
            </h4>
            <button class="btn primary-btn" id="xray-config-add-inbound-btn" style="padding: 4px 10px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; height: auto;"><i class="fa-solid fa-plus"></i> <span data-i18n="config_add_inbound">Добавить Inbound</span></button>
        </div>`;
                
    if (config.inbounds && config.inbounds.length > 0) {
        config.inbounds.forEach((ib, idx) => {
            let streamDesc = "";
            let securityType = "None";
            if (ib.streamSettings) {
                const ss = ib.streamSettings;
                securityType = ss.security || "None";
                if (ss.network) {
                    streamDesc += `Network: <code>${ss.network}</code>`;
                }
                if (ss.security === "reality" && ss.realitySettings) {
                    const rs = ss.realitySettings;
                    streamDesc += ` | Reality Dest: <code style="color: #18dcff;">${rs.dest || "—"}</code> | ServerNames: <code>${(rs.serverNames || []).join(", ")}</code>`;
                } else if (ss.security === "tls" && ss.tlsSettings) {
                    const ts = ss.tlsSettings;
                    streamDesc += ` | TLS ServerName: <code style="color: #18dcff;">${ts.serverName || "—"}</code>`;
                }
            }
            
            // Clients parsing
            let clientsRows = "";
            let clientsList = [];
            if (ib.settings && ib.settings.clients) {
                clientsList = ib.settings.clients;
            }
            
            if (clientsList.length > 0) {
                clientsRows = `<div class="table-container" style="margin-top: 10px;">
                    <table class="glass-table" style="font-size: 12px; background: rgba(0,0,0,0.15); border-radius: 8px;">
                        <thead>
                            <tr>
                                <th style="padding: 8px 12px;">Email</th>
                                <th style="padding: 8px 12px;">UUID / Password</th>
                                <th style="padding: 8px 12px;">Flow / AlterId</th>
                            </tr>
                        </thead>
                        <tbody>`;
                clientsList.forEach(c => {
                    const pwd = c.id || c.password || "—";
                    const flow = c.flow || (c.alterId !== undefined ? `AlterId: ${c.alterId}` : "—");
                    clientsRows += `<tr>
                        <td style="padding: 8px 12px;"><strong>${c.email || "—"}</strong></td>
                        <td style="padding: 8px 12px; font-family: monospace; user-select: text;">${pwd}</td>
                        <td style="padding: 8px 12px;"><code>${flow}</code></td>
                    </tr>`;
                });
                clientsRows += `</tbody></table></div>`;
            } else if (ib.protocol === "dokodemo-door") {
                clientsRows = `<div style="font-size: 12px; color: var(--text-muted); margin-top: 8px; font-style: italic;">gRPC API управления</div>`;
            } else if (ib.settings && ib.settings.accounts) {
                // Socks accounts
                const users = ib.settings.accounts.map(a => a.user || "unknown");
                clientsRows = `<div style="font-size: 12px; color: var(--text-secondary); margin-top: 8px;">
                     Socks5 Auth: ` + users.map(u => `<span class="badge active" style="margin: 2px; display: inline-block;">${u}</span>`).join(" ") + 
                `</div>`;
            } else {
                clientsRows = `<div style="font-size: 12px; color: var(--text-muted); margin-top: 8px; font-style: italic;">Нет настроенных клиентов</div>`;
            }
            
            // Shadowsocks options
            let ssOptions = "";
            if (ib.protocol === "shadowsocks" && ib.settings && ib.settings.method) {
                ssOptions = `<div style="margin-top: 4px;">Method: <code>${ib.settings.method}</code></div>`;
            }
            
            let securityBadgeClass = "tag-badge-direct";
            if (securityType === "reality") securityBadgeClass = "tag-badge-warp";
            else if (securityType === "tls") securityBadgeClass = "tag-badge-proxy";
            
            html += `<div class="glass-card" style="padding: 16px; margin-bottom: 15px; border-radius: 12px; background: rgba(255,255,255,0.015); border: 1px solid var(--border-color);">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 8px; margin-bottom: 10px;">
                    <div>
                        <span class="tag-badge tag-badge-warp" style="text-transform: uppercase; font-size: 11px;">${ib.protocol}</span>
                        <strong style="font-size: 14px; color: var(--text-primary); margin-left: 8px;">:${ib.port || ib.listen || "—"}</strong>
                        <span style="font-size: 12px; color: var(--text-muted); font-family: monospace; margin-left: 10px;">(Tag: ${ib.tag || "—"})</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <button class="btn secondary-btn edit-json-btn" data-type="xray-inbound" data-index="${idx}" style="padding: 4px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; height: auto;"><i class="fa-regular fa-pen-to-square"></i> JSON</button>
                        <span class="tag-badge ${securityBadgeClass}">${securityType}</span>
                    </div>
                </div>
                <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.6;">
                    ${streamDesc ? `<div>Transport: ${streamDesc}</div>` : ""}
                    ${ssOptions}
                </div>
                ${clientsRows}
            </div>`;
        });
    } else {
        html += `<div class="glass-card" style="padding: 20px; text-align: center; color: var(--text-muted);" data-i18n="config_no_inbounds">Входящие подключения отсутствуют</div>`;
    }
    html += `</div>`;
    
    // -- 3. OUTBOUNDS --
    html += `<div style="margin-bottom: 25px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 10px;">
            <h4 style="margin: 0; font-size: 15px; font-weight: 600; color: var(--accent-green); display: flex; align-items: center; gap: 8px;">
                <i class="fa-solid fa-arrow-right-from-bracket"></i> <span data-i18n="xray_config_outbounds">Исходящие подключения (Outbounds)</span>
            </h4>
            <button class="btn primary-btn" id="xray-config-add-outbound-btn" style="padding: 4px 10px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; height: auto;"><i class="fa-solid fa-plus"></i> <span data-i18n="config_add_outbound">Добавить Outbound</span></button>
        </div>`;
                
    if (config.outbounds && config.outbounds.length > 0) {
        config.outbounds.forEach((ob, idx) => {
            let details = "";
            let extra = "";
            
            if (ob.settings && ob.settings.vnext) {
                ob.settings.vnext.forEach(v => {
                    const address = v.address || "—";
                    const port = v.port || "—";
                    let users = "";
                    if (v.users) {
                        users = v.users.map(u => u.id || u.email || "—").join(", ");
                    }
                    details += `<div>Server: <strong style="color: var(--text-primary);">${address}:${port}</strong>${users ? ` | Users: <code>${users}</code>` : ""}</div>`;
                });
            } else if (ob.settings && ob.settings.servers) {
                ob.settings.servers.forEach(s => {
                    const address = s.address || "—";
                    const port = s.port || "—";
                    details += `<div>Server: <strong style="color: var(--text-primary);">${address}:${port}</strong></div>`;
                });
            } else if (ob.protocol === "freedom") {
                details = `<span style="color: var(--accent-green);" data-i18n="xray_outbound_direct">Прямое подключение (Direct)</span>`;
            } else if (ob.protocol === "blackhole") {
                details = `<span style="color: var(--accent-rose);" data-i18n="xray_outbound_blocked">Блокировка трафика (Blocked)</span>`;
            } else {
                details = `<span style="color: var(--text-muted); font-style: italic;">—</span>`;
            }
            
            if (ob.streamSettings) {
                const ss = ob.streamSettings;
                let security = ss.security || "none";
                extra = `<div>Transport: <code>${ss.network || "tcp"}</code> (Security: <code>${security}</code>)</div>`;
            }
            
            let badgeClass = "tag-badge-direct";
            if (ob.tag === "blocked") badgeClass = "tag-badge-blocked";
            else if (ob.tag === "warp") badgeClass = "tag-badge-warp";
            else if (ob.tag === "api") badgeClass = "tag-badge-api";
            else if (ob.protocol !== "freedom") badgeClass = "tag-badge-proxy";
            
            html += `<div class="glass-card" style="padding: 15px; margin-bottom: 12px; border-radius: 10px; background: rgba(255,255,255,0.015); border: 1px solid var(--border-color);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 6px;">
                    <div>
                        <span class="tag-badge ${badgeClass}" style="text-transform: uppercase; font-size: 11px;">${ob.protocol}</span>
                        <strong style="font-family: monospace; font-size: 13px; margin-left: 8px; color: var(--text-primary);">${ob.tag || "—"}</strong>
                    </div>
                    <div>
                        <button class="btn secondary-btn edit-json-btn" data-type="xray-outbound" data-index="${idx}" style="padding: 4px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; height: auto;"><i class="fa-regular fa-pen-to-square"></i> JSON</button>
                    </div>
                </div>
                <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.6;">
                    ${details}
                    ${extra}
                </div>
            </div>`;
        });
    } else {
        html += `<div class="glass-card" style="padding: 20px; text-align: center; color: var(--text-muted);" data-i18n="config_no_outbounds">Исходящие подключения отсутствуют</div>`;
    }
    html += `</div>`;
    
    // -- 4. ROUTING RULES --
    html += `<div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <h4 style="margin: 0; font-size: 15px; font-weight: 600; color: var(--accent-purple); display: flex; align-items: center; gap: 8px;">
                <i class="fa-solid fa-route"></i> <span data-i18n="xray_config_rules">Правила маршрутизации (Routing Rules)</span>
            </h4>
            <button class="btn secondary-btn edit-json-btn" data-type="xray-routing" style="padding: 4px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; height: auto;"><i class="fa-regular fa-pen-to-square"></i> JSON</button>
        </div>
        <div class="table-container">
            <table class="glass-table">
                <thead>
                    <tr>
                        <th data-i18n="xray_config_th_outbound">Назначение</th>
                        <th data-i18n="xray_config_th_rules_details">Правило / Фильтр</th>
                    </tr>
                </thead>
                <tbody>`;
                
    if (config.routing && config.routing.rules && config.routing.rules.length > 0) {
        config.routing.rules.forEach(rule => {
            let ruleDetails = [];
            if (rule.inboundTag) ruleDetails.push(`Inbound: <code>${JSON.stringify(rule.inboundTag)}</code>`);
            if (rule.domain) ruleDetails.push(`Domains: <code>${rule.domain.length}</code>`);
            if (rule.ip) ruleDetails.push(`IPs: <code>${rule.ip.length}</code>`);
            if (rule.protocol) ruleDetails.push(`Protocols: <code>${JSON.stringify(rule.protocol)}</code>`);
            if (rule.user) ruleDetails.push(`Users: <code>${rule.user.length}</code>`);
            
            let badgeClass = "tag-badge-direct";
            if (rule.outboundTag === "blocked") badgeClass = "tag-badge-blocked";
            else if (rule.outboundTag === "warp") badgeClass = "tag-badge-warp";
            else if (rule.outboundTag === "api") badgeClass = "tag-badge-api";
            else if (rule.outboundTag !== "direct") badgeClass = "tag-badge-proxy";
            
            html += `<tr>
                <td><span class="tag-badge ${badgeClass}">${rule.outboundTag}</span></td>
                <td style="font-size: 13px; line-height: 1.5;">${ruleDetails.join(" | ") || '<span style="color: var(--text-muted); font-style: italic;" data-i18n="config_any_traffic">Любой трафик</span>'}</td>
            </tr>`;
        });
    } else {
        html += `<tr><td colspan="2" style="text-align: center; color: var(--text-muted);" data-i18n="config_no_rules">Правила маршрутизации отсутствуют</td></tr>`;
    }
    html += `</tbody></table></div></div>`;
    
    parsedContainer.innerHTML = html;
    
    // Bind dynamically generated edit buttons
    parsedContainer.querySelectorAll(".edit-json-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const type = btn.getAttribute("data-type");
            const idx = parseInt(btn.getAttribute("data-index"));
            
            if (type === "xray-log") {
                window.openJsonEditModal(t("config_log_title", "Системные настройки и логирование"), config.log || {}, async (newObj) => {
                    config.log = newObj;
                    await saveXrayConfigToServer();
                });
            } else if (type === "xray-inbound") {
                const ib = config.inbounds[idx];
                window.openJsonEditModal(`${t("nav_inbounds", "Подключение")}: ${ib.protocol} (:${ib.port || ib.listen || ""})`, ib, async (newObj) => {
                    config.inbounds[idx] = newObj;
                    await saveXrayConfigToServer();
                });
            } else if (type === "xray-outbound") {
                const ob = config.outbounds[idx];
                window.openJsonEditModal(`${t("xray_config_outbounds", "Исходящее")}: ${ob.protocol} (${ob.tag || ""})`, ob, async (newObj) => {
                    config.outbounds[idx] = newObj;
                    await saveXrayConfigToServer();
                });
            } else if (type === "xray-routing") {
                window.openJsonEditModal(t("xray_config_rules", "Правила маршрутизации"), config.routing || {}, async (newObj) => {
                    config.routing = newObj;
                    await saveXrayConfigToServer();
                });
            }
        });
    });

    const addInboundBtn = document.getElementById("xray-config-add-inbound-btn");
    if (addInboundBtn) {
        addInboundBtn.addEventListener("click", () => {
            const template = {
                "protocol": "vless",
                "port": 12345,
                "settings": {
                    "clients": []
                },
                "streamSettings": {
                    "network": "tcp",
                    "security": "none"
                },
                "tag": "vless_custom"
            };
            window.openJsonEditModal(t("config_add_inbound_title", "Добавление Inbound JSON"), template, async (newObj) => {
                if (!config.inbounds) config.inbounds = [];
                config.inbounds.push(newObj);
                await saveXrayConfigToServer();
            });
        });
    }

    const addOutboundBtn = document.getElementById("xray-config-add-outbound-btn");
    if (addOutboundBtn) {
        addOutboundBtn.addEventListener("click", () => {
            const template = {
                "protocol": "freedom",
                "settings": {},
                "tag": "direct_custom"
            };
            window.openJsonEditModal(t("config_add_outbound_title", "Добавление Outbound JSON"), template, async (newObj) => {
                if (!config.outbounds) config.outbounds = [];
                config.outbounds.push(newObj);
                await saveXrayConfigToServer();
            });
        });
    }
    
    translatePage();
}

export async function saveXrayConfigToServer() {
    const res = await apiFetch("/api/xray/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: window.xrayConfig })
    });
    if (res && res.success) {
        showToast(t("config_saved_success", "Конфигурация успешно сохранена и ядро перезапущено!"));
        await loadXrayConfig();
    } else {
        throw new Error(res ? res.msg : t("config_save_error", "Ошибка при сохранении конфигурации"));
    }
}

export function setupXrayConfigListeners() {
    const xrayTabParsed = document.getElementById("xray-config-tab-parsed");
    const xrayTabRaw = document.getElementById("xray-config-tab-raw");
    const xraySaveBtn = document.getElementById("xray-config-save-btn");
    const xrayResetBtn = document.getElementById("xray-config-reset-btn");
    if (xrayTabParsed && xrayTabRaw) {
        xrayTabParsed.addEventListener("click", () => {
            xrayTabParsed.classList.add("active");
            xrayTabRaw.classList.remove("active");
            document.getElementById("xray-config-parsed-container").style.display = "block";
            document.getElementById("xray-config-raw-container").style.display = "none";
            if (xraySaveBtn) xraySaveBtn.style.display = "none";
            if (xrayResetBtn) xrayResetBtn.style.display = "none";
        });
        
        xrayTabRaw.addEventListener("click", () => {
            xrayTabRaw.classList.add("active");
            xrayTabParsed.classList.remove("active");
            document.getElementById("xray-config-raw-container").style.display = "block";
            document.getElementById("xray-config-parsed-container").style.display = "none";
            if (xraySaveBtn) xraySaveBtn.style.display = "inline-flex";
            if (xrayResetBtn) xrayResetBtn.style.display = "inline-flex";
        });
    }
    
    if (xraySaveBtn) {
        xraySaveBtn.addEventListener("click", async () => {
            const rawVal = document.getElementById("xray-config-raw-pre").value;
            let parsed = null;
            try {
                parsed = JSON.parse(rawVal);
            } catch (err) {
                showToast(t("config_invalid_json", "Некорректный формат JSON"), "error");
                return;
            }
            
            xraySaveBtn.disabled = true;
            const res = await apiFetch("/api/xray/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ config: parsed })
            });
            xraySaveBtn.disabled = false;
            
            if (res && res.success) {
                showToast(t("config_saved_success", "Конфигурация успешно сохранена и ядро перезапущено!"));
                loadXrayConfig();
            } else {
                showToast(res ? res.msg : t("config_save_error", "Ошибка при сохранении конфигурации"), "error");
            }
        });
    }
    
    if (xrayResetBtn) {
        xrayResetBtn.addEventListener("click", async () => {
            if (!confirm(t("config_confirm_reset", "Вы уверены, что хотите сбросить конфигурацию на автоматическую генерацию из БД?"))) {
                return;
            }
            xrayResetBtn.disabled = true;
            const res = await apiFetch("/api/xray/config/reset", { method: "POST" });
            xrayResetBtn.disabled = false;
            
            if (res && res.success) {
                showToast(t("config_reset_success", "Сброшено на автогенерацию из БД!"));
                loadXrayConfig();
            } else {
                showToast(res ? res.msg : t("config_reset_error", "Ошибка при сбросе конфигурации"), "error");
            }
        });
    }
}

window.openJsonEditModal = function(title, currentObj, onSave) {
    const modal = document.getElementById("json-edit-modal");
    if (!modal) return;
    
    const titleEl = document.getElementById("json-modal-title");
    const textareaEl = document.getElementById("json-modal-textarea");
    const labelEl = document.getElementById("json-modal-label");
    
    if (titleEl) titleEl.innerText = title;
    if (labelEl) labelEl.innerText = t("config_json_modal_label", "Введите корректный JSON-код:");
    if (textareaEl) textareaEl.value = JSON.stringify(currentObj, null, 2);
    
    modal.classList.add("active");
    
    const saveBtn = document.getElementById("json-modal-save-btn");
    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
    
    const cancelBtn = document.getElementById("json-modal-cancel-btn");
    const newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    
    const closeBtn = document.getElementById("json-modal-close-btn");
    const newCloseBtn = closeBtn.cloneNode(true);
    closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
    
    const closeModal = () => modal.classList.remove("active");
    
    newCancelBtn.addEventListener("click", closeModal);
    newCloseBtn.addEventListener("click", closeModal);
    
    newSaveBtn.addEventListener("click", async () => {
        const textVal = textareaEl.value;
        let parsed = null;
        try {
            parsed = JSON.parse(textVal);
        } catch (err) {
            showToast(t("config_invalid_json", "Некорректный формат JSON"), "error");
            return;
        }
        
        newSaveBtn.disabled = true;
        try {
            await onSave(parsed);
            closeModal();
        } catch (err) {
            showToast(err.message || t("config_save_error", "Ошибка при сохранении"), "error");
        } finally {
            newSaveBtn.disabled = false;
        }
    });
};

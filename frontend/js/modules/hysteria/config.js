import { apiFetch } from "../../api.js";
import { showToast } from "../../ui.js";
import { t, translatePage } from "../../i18n.js";

export async function loadHysteriaConfig(preferredIndex = 0) {
    const res = await apiFetch("/api/hysteria/config");
    if (!res || !res.success) return;
    
    window.hysteriaConfigs = res.configs || [];
    
    const selectWrapper = document.getElementById("hysteria-inbound-select-wrapper");
    const select = document.getElementById("hysteria-config-inbound-select");
    const parsedContainer = document.getElementById("hysteria-config-parsed-container");
    const rawPre = document.getElementById("hysteria-config-raw-pre");
    
    if (window.hysteriaConfigs.length === 0) {
        if (selectWrapper) selectWrapper.style.display = "none";
        if (parsedContainer) {
            parsedContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px;" data-i18n="config_no_active_inbounds">Нет активных подключений Hysteria 2</div>`;
        }
        if (rawPre) rawPre.value = "";
        return;
    }
    
    // Populating dropdown
    if (select) {
        select.innerHTML = "";
        window.hysteriaConfigs.forEach((c, idx) => {
            const opt = document.createElement("option");
            opt.value = idx;
            opt.text = `${c.remark || "Hysteria"} (Port: ${c.port})`;
            select.appendChild(opt);
        });
        
        if (window.hysteriaConfigs.length > 1) {
            if (selectWrapper) selectWrapper.style.display = "flex";
        } else {
            if (selectWrapper) selectWrapper.style.display = "none";
        }
        
        if (preferredIndex >= 0 && preferredIndex < window.hysteriaConfigs.length) {
            select.value = preferredIndex;
        } else {
            select.value = 0;
        }
    }
    
    const selectedIdx = select ? parseInt(select.value) : 0;
    renderSelectedHysteriaConfig(window.hysteriaConfigs[selectedIdx].config);
}

function renderSelectedHysteriaConfig(config) {
    const rawPre = document.getElementById("hysteria-config-raw-pre");
    if (rawPre) {
        rawPre.value = JSON.stringify(config, null, 2);
    }
    
    const parsedContainer = document.getElementById("hysteria-config-parsed-container");
    if (!parsedContainer) return;
    
    let html = "";
    
    // General parameters title & Edit JSON button
    html += `<div style="margin-bottom: 25px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <h4 style="margin: 0; font-size: 15px; font-weight: 600; color: var(--accent-orange); display: flex; align-items: center; gap: 8px;">
                <i class="fa-solid fa-gears"></i> <span data-i18n="config_general_title">Основные параметры Hysteria 2</span>
            </h4>
            <button class="btn secondary-btn edit-json-btn" data-type="hysteria-general" style="padding: 4px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; height: auto;"><i class="fa-regular fa-pen-to-square"></i> JSON</button>
        </div>`;
    
    // General info grid (Listen, TLS, Masquerade, Bandwidth)
    html += `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin-bottom: 25px;">`;
    
    // 1. Listen & Port Hopping Card
    html += `<div class="glass-card" style="padding: 15px; border-radius: 10px; background: rgba(255,255,255,0.02);">
        <h5 style="margin-top: 0; margin-bottom: 10px; font-size: 14px; font-weight: 600; color: var(--accent-blue);"><i class="fa-solid fa-ear-listen"></i> Listen Options</h5>
        <div style="font-size: 13px; line-height: 1.6;">
            <div>Address/Port: <strong style="color: var(--text-primary); font-family: monospace;">${config.listen || "—"}</strong></div>
            <div>Obfuscation: <strong style="color: var(--text-primary);">${config.obfs && config.obfs.type ? `<span class="badge active" style="background: rgba(16, 185, 129, 0.15); color: var(--accent-green); font-size: 11px;">${config.obfs.type}</span>` : `<span style="color: var(--text-muted);">Disabled</span>`}</strong></div>
            ${config.obfs && config.obfs.salamander && config.obfs.salamander.password ? `<div>Obfs Password: <code style="font-size: 12px;">${config.obfs.salamander.password}</code></div>` : ""}
        </div>
    </div>`;
    
    // 2. TLS Settings
    html += `<div class="glass-card" style="padding: 15px; border-radius: 10px; background: rgba(255,255,255,0.02);">
        <h5 style="margin-top: 0; margin-bottom: 10px; font-size: 14px; font-weight: 600; color: var(--accent-purple);"><i class="fa-solid fa-lock"></i> TLS Certificates</h5>
        <div style="font-size: 13px; line-height: 1.6; word-break: break-all;">
            <div>Cert: <code style="font-size: 11px;">${config.tls && config.tls.cert ? config.tls.cert : "—"}</code></div>
            <div>Key: <code style="font-size: 11px;">${config.tls && config.tls.key ? config.tls.key : "—"}</code></div>
        </div>
    </div>`;
    
    // 3. Masquerade Settings
    let masqDetails = "";
    if (config.masquerade) {
        const type = config.masquerade.type;
        if (type === "proxy" && config.masquerade.proxy) {
            masqDetails = `Proxy to: <strong style="color: var(--text-primary); font-family: monospace;">${config.masquerade.proxy.url}</strong>`;
        } else if (type === "status" && config.masquerade.status) {
            masqDetails = `Status Code: <strong style="color: var(--text-primary);">${config.masquerade.status.code}</strong>`;
        } else if (type === "file" && config.masquerade.file) {
            masqDetails = `Dir: <strong style="color: var(--text-primary); font-family: monospace;">${config.masquerade.file.dir}</strong>`;
        } else {
            masqDetails = `Type: <strong>${type}</strong>`;
        }
    } else {
        masqDetails = `None`;
    }
    
    html += `<div class="glass-card" style="padding: 15px; border-radius: 10px; background: rgba(255,255,255,0.02);">
        <h5 style="margin-top: 0; margin-bottom: 10px; font-size: 14px; font-weight: 600; color: var(--accent-orange);"><i class="fa-solid fa-mask"></i> Masquerade (Decoy)</h5>
        <div style="font-size: 13px; line-height: 1.6;">
            <div>Type: <span class="tag-badge tag-badge-warp" style="padding: 2px 6px; font-size: 10px;">${config.masquerade ? config.masquerade.type : "none"}</span></div>
            <div>${masqDetails}</div>
        </div>
    </div>`;
    
    // 4. Bandwidth limits
    html += `<div class="glass-card" style="padding: 15px; border-radius: 10px; background: rgba(255,255,255,0.02);">
        <h5 style="margin-top: 0; margin-bottom: 10px; font-size: 14px; font-weight: 600; color: var(--accent-rose);"><i class="fa-solid fa-gauge-high"></i> Bandwidth Limits</h5>
        <div style="font-size: 13px; line-height: 1.6;">
            <div>Max Up: <strong style="color: var(--text-primary);">${config.bandwidth && config.bandwidth.up ? config.bandwidth.up : "Unlimited"}</strong></div>
            <div>Max Down: <strong style="color: var(--text-primary);">${config.bandwidth && config.bandwidth.down ? config.bandwidth.down : "Unlimited"}</strong></div>
        </div>
    </div>`;
    
    html += `</div></div>`; // End of grid & general options div
    
    // 5. Auth Users Table
    html += `<div style="margin-bottom: 25px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <h4 style="margin: 0; font-size: 15px; font-weight: 600; color: var(--accent-blue); display: flex; align-items: center; gap: 8px;">
                <i class="fa-solid fa-users"></i> <span data-i18n="hysteria_config_users">Авторизованные пользователи (Auth Users)</span>
            </h4>
            <button class="btn secondary-btn edit-json-btn" data-type="hysteria-auth" style="padding: 4px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; height: auto;"><i class="fa-regular fa-pen-to-square"></i> JSON</button>
        </div>
        <div class="table-container">
            <table class="glass-table">
                <thead>
                    <tr>
                        <th data-i18n="hysteria_config_th_email">Идентификатор (Email)</th>
                        <th data-i18n="hysteria_config_th_password">Пароль / UUID</th>
                    </tr>
                </thead>
                <tbody>`;
                
    if (config.auth && config.auth.userpass) {
        const users = Object.entries(config.auth.userpass);
        if (users.length > 0) {
            users.forEach(([email, pwd]) => {
                html += `<tr>
                    <td style="font-weight: 600; color: var(--text-primary);">${email}</td>
                    <td style="font-family: monospace; font-size: 12px;">${pwd}</td>
                </tr>`;
            });
        } else {
            html += `<tr><td colspan="2" style="text-align: center; color: var(--text-muted);" data-i18n="config_no_users">Нет активных пользователей</td></tr>`;
        }
    } else {
        html += `<tr><td colspan="2" style="text-align: center; color: var(--text-muted);" data-i18n="config_no_users">Пользователи отсутствуют</td></tr>`;
    }
    html += `</tbody></table></div></div>`;
    
    // 6. Outbounds (if routing via Xray)
    if (config.outbounds && config.outbounds.length > 0) {
        html += `<div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <h4 style="margin: 0; font-size: 15px; font-weight: 600; color: var(--accent-green); display: flex; align-items: center; gap: 8px;">
                    <i class="fa-solid fa-arrow-right-from-bracket"></i> <span data-i18n="hysteria_config_outbounds">Исходящие подключения (Outbounds)</span>
                </h4>
                <button class="btn secondary-btn edit-json-btn" data-type="hysteria-outbounds" style="padding: 4px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; height: auto;"><i class="fa-regular fa-pen-to-square"></i> JSON</button>
            </div>
            <div class="table-container">
                <table class="glass-table">
                    <thead>
                        <tr>
                            <th data-i18n="hysteria_config_th_out_name">Имя</th>
                            <th data-i18n="hysteria_config_th_out_type">Тип</th>
                            <th data-i18n="hysteria_config_th_out_addr">Адрес (Proxy)</th>
                        </tr>
                    </thead>
                    <tbody>`;
                    
        config.outbounds.forEach(ob => {
            let addr = "—";
            if (ob.socks5) {
                addr = `${ob.socks5.addr}`;
                if (ob.socks5.user) addr += ` (${ob.socks5.user})`;
            }
            html += `<tr>
                <td style="font-weight: 600; color: var(--text-primary);">${ob.name || "—"}</td>
                <td><span class="tag-badge tag-badge-proxy">${ob.type || "socks5"}</span></td>
                <td style="font-family: monospace; font-size: 12px;">${addr}</td>
            </tr>`;
        });
        
        html += `</tbody></table></div></div>`;
    }
    
    parsedContainer.innerHTML = html;
    
    // Bind edit buttons for Hysteria
    parsedContainer.querySelectorAll(".edit-json-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const type = btn.getAttribute("data-type");
            const select = document.getElementById("hysteria-config-inbound-select");
            if (!select || !window.hysteriaConfigs || window.hysteriaConfigs.length === 0) return;
            
            const selectedIdx = parseInt(select.value);
            if (isNaN(selectedIdx) || !window.hysteriaConfigs[selectedIdx]) return;
            
            const item = window.hysteriaConfigs[selectedIdx];
            const inboundId = item.inbound_id;
            const fullConfig = item.config;
            
            if (type === "hysteria-general") {
                const generalSnippet = {
                    listen: fullConfig.listen,
                    obfs: fullConfig.obfs,
                    tls: fullConfig.tls,
                    masquerade: fullConfig.masquerade,
                    bandwidth: fullConfig.bandwidth
                };
                window.openJsonEditModal(t("config_general_title", "Основные параметры Hysteria 2"), generalSnippet, async (newSnippet) => {
                    fullConfig.listen = newSnippet.listen;
                    fullConfig.obfs = newSnippet.obfs;
                    fullConfig.tls = newSnippet.tls;
                    fullConfig.masquerade = newSnippet.masquerade;
                    fullConfig.bandwidth = newSnippet.bandwidth;
                    await saveHysteriaConfigToServer(inboundId, fullConfig, selectedIdx);
                });
            } else if (type === "hysteria-auth") {
                window.openJsonEditModal(t("config_auth_title", "Авторизованные пользователи Hysteria 2"), fullConfig.auth || {}, async (newAuth) => {
                    fullConfig.auth = newAuth;
                    await saveHysteriaConfigToServer(inboundId, fullConfig, selectedIdx);
                });
            } else if (type === "hysteria-outbounds") {
                window.openJsonEditModal(t("config_outbounds_title", "Исходящие подключения Hysteria 2"), fullConfig.outbounds || [], async (newOutbounds) => {
                    fullConfig.outbounds = newOutbounds;
                    await saveHysteriaConfigToServer(inboundId, fullConfig, selectedIdx);
                });
            }
        });
    });
    
    translatePage();
}

async function saveHysteriaConfigToServer(inboundId, config, selectedIdx) {
    const res = await apiFetch("/api/hysteria/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inbound_id: inboundId, config: config })
    });
    if (res && res.success) {
        showToast(t("config_saved_success", "Конфигурация успешно сохранена и ядро перезапущено!"));
        await loadHysteriaConfig(selectedIdx);
    } else {
        throw new Error(res ? res.msg : t("config_save_error", "Ошибка при сохранении конфигурации"));
    }
}

export function setupHysteriaConfigListeners() {
    const hysteriaTabParsed = document.getElementById("hysteria-config-tab-parsed");
    const hysteriaTabRaw = document.getElementById("hysteria-config-tab-raw");
    const saveBtn = document.getElementById("hysteria-config-save-btn");
    const resetBtn = document.getElementById("hysteria-config-reset-btn");
    if (hysteriaTabParsed && hysteriaTabRaw) {
        hysteriaTabParsed.addEventListener("click", () => {
            hysteriaTabParsed.classList.add("active");
            hysteriaTabRaw.classList.remove("active");
            document.getElementById("hysteria-config-parsed-container").style.display = "block";
            document.getElementById("hysteria-config-raw-container").style.display = "none";
            if (saveBtn) saveBtn.style.display = "none";
            if (resetBtn) resetBtn.style.display = "none";
        });
        
        hysteriaTabRaw.addEventListener("click", () => {
            hysteriaTabRaw.classList.add("active");
            hysteriaTabParsed.classList.remove("active");
            document.getElementById("hysteria-config-raw-container").style.display = "block";
            document.getElementById("hysteria-config-parsed-container").style.display = "none";
            if (saveBtn) saveBtn.style.display = "inline-flex";
            if (resetBtn) resetBtn.style.display = "inline-flex";
        });
    }
    
    if (saveBtn) {
        saveBtn.addEventListener("click", async () => {
            const select = document.getElementById("hysteria-config-inbound-select");
            if (!select || !window.hysteriaConfigs || window.hysteriaConfigs.length === 0) return;
            
            const selectedIdx = parseInt(select.value);
            if (isNaN(selectedIdx) || !window.hysteriaConfigs[selectedIdx]) return;
            
            const inboundId = window.hysteriaConfigs[selectedIdx].inbound_id;
            const rawVal = document.getElementById("hysteria-config-raw-pre").value;
            
            let parsed = null;
            try {
                parsed = JSON.parse(rawVal);
            } catch (err) {
                showToast(t("config_invalid_json", "Некорректный формат JSON"), "error");
                return;
            }
            
            saveBtn.disabled = true;
            const res = await apiFetch("/api/hysteria/config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ inbound_id: inboundId, config: parsed })
            });
            saveBtn.disabled = false;
            
            if (res && res.success) {
                showToast(t("config_saved_success", "Конфигурация успешно сохранена и ядро перезапущено!"));
                await loadHysteriaConfig(selectedIdx);
            } else {
                showToast(res ? res.msg : t("config_save_error", "Ошибка при сохранении конфигурации"), "error");
            }
        });
    }
    
    if (resetBtn) {
        resetBtn.addEventListener("click", async () => {
            const select = document.getElementById("hysteria-config-inbound-select");
            if (!select || !window.hysteriaConfigs || window.hysteriaConfigs.length === 0) return;
            
            const selectedIdx = parseInt(select.value);
            if (isNaN(selectedIdx) || !window.hysteriaConfigs[selectedIdx]) return;
            
            const inboundId = window.hysteriaConfigs[selectedIdx].inbound_id;
            if (!confirm(t("config_confirm_reset", "Вы уверены, что хотите сбросить конфигурацию на автоматическую генерацию из БД?"))) {
                return;
            }
            
            resetBtn.disabled = true;
            const res = await apiFetch("/api/hysteria/config/reset", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ inbound_id: inboundId })
            });
            resetBtn.disabled = false;
            
            if (res && res.success) {
                showToast(t("config_reset_success", "Сброшено на автогенерацию из БД!"));
                await loadHysteriaConfig(selectedIdx);
            } else {
                showToast(res ? res.msg : t("config_reset_error", "Ошибка при сбросе конфигурации"), "error");
            }
        });
    }
    
    // Selector for Hysteria configs
    const hysteriaSelect = document.getElementById("hysteria-config-inbound-select");
    if (hysteriaSelect) {
        hysteriaSelect.addEventListener("change", (e) => {
            const index = parseInt(e.target.value);
            if (!isNaN(index) && window.hysteriaConfigs && window.hysteriaConfigs[index]) {
                renderSelectedHysteriaConfig(window.hysteriaConfigs[index].config);
            }
        });
    }
}

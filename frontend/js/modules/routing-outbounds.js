import { apiFetch } from "../api.js";
import { showToast, formatBytes, showConfirmDialog } from "../ui.js";
import { t } from "../i18n.js";
import { updateOutboundFormFields } from "./routing/outbound-form.js";

// Re-export modular functions
export { parseProxyLink } from "./routing/link-parser.js";
export { updateOutboundFormFields, validateOutboundForm } from "./routing/outbound-form.js";

export let outboundsCache = [];

export function setOutboundsCache(val) {
    outboundsCache = val;
}

export async function loadOutbounds() {
    const res = await apiFetch("/api/routing/outbounds");
    if (!res || !res.success) return;
    
    outboundsCache = res.obj;
    const tbody = document.getElementById("outbounds-list-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    
    res.obj.forEach(ob => {
        const tr = document.createElement("tr");
        tr.style.borderBottom = "1px solid var(--border-color)";
        
        let settingsText = "";
        try {
            const settingsObj = JSON.parse(ob.settings || "{}");
            if (ob.protocol === "socks" || ob.protocol === "http" || ob.protocol === "shadowsocks") {
                const server = settingsObj.servers ? settingsObj.servers[0] : null;
                if (server) {
                    settingsText = `${server.address}:${server.port}`;
                }
            } else if (ob.protocol === "vless") {
                const server = settingsObj.vnext ? settingsObj.vnext[0] : null;
                if (server) {
                    settingsText = `${server.address}:${server.port}`;
                }
            } else if (ob.protocol === "hysteria") {
                if (settingsObj.address && settingsObj.port) {
                    settingsText = `${settingsObj.address}:${settingsObj.port}`;
                }
            } else {
                settingsText = "-";
            }
        } catch (e) {
            settingsText = "Error";
        }
        
        let badgeClass = "tag-badge";
        const protoLower = ob.protocol.toLowerCase();
        const tagLower = ob.tag.toLowerCase();
        if (protoLower === "freedom" || tagLower === "direct") {
            badgeClass += " tag-badge-direct";
        } else if (protoLower === "blackhole" || tagLower === "blocked") {
            badgeClass += " tag-badge-blocked";
        } else if (tagLower === "warp") {
            badgeClass += " tag-badge-warp";
        } else {
            badgeClass += " tag-badge-proxy";
        }

        const deleteBtn = ob.is_system === 1 
            ? `<button class="table-action-btn delete-btn" disabled><i class="fa-regular fa-trash-can"></i></button>`
            : `<button class="table-action-btn delete-btn" onclick="window.deleteOutbound(${ob.id})" title="${t("routing_btn_delete", "Удалить")}"><i class="fa-regular fa-trash-can"></i></button>`;
            
        const downFormatted = formatBytes(ob.down || 0);
        const upFormatted = formatBytes(ob.up || 0);
        const trafficText = `<span style="color: var(--accent-blue);"><i class="fa-solid fa-arrow-down" style="margin-right: 4px; font-size: 11px;"></i>${downFormatted}</span> <span style="color: var(--text-secondary); margin: 0 4px;">/</span> <span style="color: var(--accent-purple);"><i class="fa-solid fa-arrow-up" style="margin-right: 4px; font-size: 11px;"></i>${upFormatted}</span>`;

        const tcpTestBtn = `<button class="table-action-btn test-btn" onclick="window.testOutbound(${ob.id}, 'tcp', this)" title="${t("routing_btn_tcp_test", "TCP пинг")}"><i class="fa-solid fa-plug"></i></button>`;
        const httpTestBtn = `<button class="table-action-btn test-btn test-btn-http" onclick="window.testOutbound(${ob.id}, 'http', this)" title="${t("routing_btn_http_test", "HTTP тест через прокси")}"><i class="fa-solid fa-globe"></i></button>`;

        tr.innerHTML = `
            <td style="padding: 12px 15px; font-weight: 500;">${ob.remark}</td>
            <td style="padding: 12px 15px;"><span class="${badgeClass}">${ob.protocol}</span></td>
            <td style="padding: 12px 15px; color: var(--accent-blue); font-family: monospace;">${ob.tag}</td>
            <td style="padding: 12px 15px; color: var(--text-secondary);">${settingsText}</td>
            <td style="padding: 12px 15px; font-size: 13px; white-space: nowrap;">${trafficText}</td>
            <td style="padding: 12px 15px;">
                <label class="switch-toggle">
                    <input type="checkbox" ${ob.enable === 1 ? 'checked' : ''} onchange="window.toggleOutbound(${ob.id}, this.checked)">
                    <span class="switch-slider"></span>
                </label>
            </td>
            <td style="padding: 12px 15px;">
                <div style="display: flex; gap: 8px;">
                    ${tcpTestBtn}
                    ${httpTestBtn}
                    <button class="table-action-btn edit-btn" onclick="window.openOutboundModal(${ob.id})" title="${t("routing_btn_edit", "Редактировать")}"><i class="fa-regular fa-pen-to-square"></i></button>
                    ${deleteBtn}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
    
    populateOutboundDropdowns();
}

export function populateOutboundDropdowns(showApi = false) {
    const select = document.getElementById("rule-outbound");
    if (!select) return;
    select.innerHTML = "";
    
    if (showApi) {
        // Add default system API outbound tag for internal API routing rules
        const optionApi = document.createElement("option");
        optionApi.value = "api";
        optionApi.innerText = "api (Internal API traffic)";
        select.appendChild(optionApi);
    }
    
    outboundsCache.forEach(ob => {
        if (ob.enable === 1) {
            const option = document.createElement("option");
            option.value = ob.tag;
            option.innerText = `${ob.tag} (${ob.protocol} - ${ob.remark})`;
            select.appendChild(option);
        }
    });
}

export async function openOutboundModal(id = null) {
    const form = document.getElementById("outbound-form");
    if (!form) return;
    form.reset();
    
    const protocolSelect = document.getElementById("ob-protocol");
    protocolSelect.disabled = false;
    
    if (id) {
        document.getElementById("outbound-modal-title").innerText = t("routing_modal_edit_outbound", "Редактирование исходящего подключения");
        const res = await apiFetch(`/api/routing/outbounds`);
        const ob = res.obj.find(x => x.id === id);
        if (ob) {
            document.getElementById("ob-id").value = ob.id;
            document.getElementById("ob-remark").value = ob.remark;
            protocolSelect.value = ob.protocol;
            // Prevent changing protocol/tag of system outbounds to avoid breaking rules
            if (ob.is_system === 1) {
                protocolSelect.disabled = true;
                document.getElementById("ob-tag").disabled = true;
            } else {
                document.getElementById("ob-tag").disabled = false;
            }
            document.getElementById("ob-tag").value = ob.tag;
            document.getElementById("ob-enable").checked = ob.enable === 1;
            
            // Populate proxy settings
            const settingsObj = JSON.parse(ob.settings || "{}");
            const streamSettingsObj = JSON.parse(ob.stream_settings || "{}");
            
            let address = "";
            let port = "";
            let password = "";
            
            document.getElementById("ob-username").value = "";
            document.getElementById("ob-password").value = "";
            document.getElementById("ob-ss-method").value = "aes-256-gcm";
            document.getElementById("ob-sni").value = "";
            document.getElementById("ob-pbk").value = "";
            document.getElementById("ob-shortid").value = "";
            document.getElementById("ob-fingerprint").value = "chrome";
            document.getElementById("ob-alpn").value = "";
            document.getElementById("ob-flow").value = "";
            document.getElementById("ob-encryption").value = "";
            document.getElementById("ob-security").value = "none";
            document.getElementById("ob-up-mbps").value = "";
            document.getElementById("ob-down-mbps").value = "";
            document.getElementById("ob-allow-insecure").checked = false;
            document.getElementById("ob-pinned-sha256").value = "";
            document.getElementById("ob-hysteria-obfs").value = "";
            document.getElementById("ob-hysteria-obfs-password").value = "";
            
            document.getElementById("ob-wg-private-key").value = "";
            document.getElementById("ob-wg-addresses").value = "";
            document.getElementById("ob-wg-reserved").value = "";
            document.getElementById("ob-wg-peer-public-key").value = "";
            document.getElementById("ob-wg-endpoint").value = "";
            document.getElementById("ob-wg-mtu").value = "";
            
            if (ob.protocol === "socks" || ob.protocol === "http" || ob.protocol === "shadowsocks") {
                const server = settingsObj.servers ? settingsObj.servers[0] : null;
                if (server) {
                    address = server.address || "";
                    port = server.port || "";
                    
                    if (server.users && server.users.length > 0) {
                        document.getElementById("ob-username").value = server.users[0].user || "";
                        password = server.users[0].pass || "";
                    } else if (server.password) {
                        password = server.password || "";
                    }
                }
                if (server && server.method) {
                    document.getElementById("ob-ss-method").value = server.method;
                }
            } else if (ob.protocol === "vless") {
                const server = settingsObj.vnext ? settingsObj.vnext[0] : null;
                if (server) {
                    address = server.address || "";
                    port = server.port || "";
                    if (server.users && server.users.length > 0) {
                        password = server.users[0].id || "";
                        document.getElementById("ob-flow").value = server.users[0].flow || "";
                        document.getElementById("ob-encryption").value = server.users[0].encryption || "";
                    }
                }
                
                const security = streamSettingsObj.security || "none";
                document.getElementById("ob-security").value = security;
                
                if (security === "tls") {
                    const ts = streamSettingsObj.tlsSettings || {};
                    document.getElementById("ob-sni").value = ts.serverName || "";
                    document.getElementById("ob-alpn").value = (ts.alpn || []).join(", ");
                    document.getElementById("ob-allow-insecure").checked = ts.allowInsecure === true;
                    let pins = ts.pinnedPeerCertSha256 || "";
                    if (typeof pins === "string") {
                        pins = pins.replace(/~/g, ", ");
                    } else if (Array.isArray(pins)) {
                        pins = pins.join(", ");
                    }
                    document.getElementById("ob-pinned-sha256").value = pins;
                } else if (security === "reality") {
                    const rs = streamSettingsObj.realitySettings || {};
                    document.getElementById("ob-sni").value = rs.serverName || "";
                    document.getElementById("ob-pbk").value = rs.publicKey || "";
                    document.getElementById("ob-shortid").value = rs.shortId || "";
                    document.getElementById("ob-fingerprint").value = rs.fingerprint || "chrome";
                }
            } else if (ob.protocol === "hysteria") {
                address = settingsObj.address || "";
                port = settingsObj.port || "";
                
                const ts = streamSettingsObj.tlsSettings || {};
                document.getElementById("ob-sni").value = ts.serverName || "";
                document.getElementById("ob-alpn").value = (ts.alpn || []).join(", ");
                document.getElementById("ob-allow-insecure").checked = ts.allowInsecure === true;
                let pins = ts.pinnedPeerCertSha256 || "";
                if (typeof pins === "string") {
                    pins = pins.replace(/~/g, ", ");
                } else if (Array.isArray(pins)) {
                    pins = pins.join(", ");
                }
                document.getElementById("ob-pinned-sha256").value = pins;
                
                const hs = streamSettingsObj.hysteriaSettings || {};
                password = hs.auth || "";
                
                const upRaw = hs.up || "";
                const downRaw = hs.down || "";
                document.getElementById("ob-up-mbps").value = upRaw ? parseInt(upRaw) : "";
                document.getElementById("ob-down-mbps").value = downRaw ? parseInt(downRaw) : "";
                
                // Populate obfs settings
                const obfsVal = hs.obfs || hs.obfs_type || "";
                const obfsPwd = hs.obfsPassword || hs.obfs_password || "";
                document.getElementById("ob-hysteria-obfs").value = obfsVal;
                document.getElementById("ob-hysteria-obfs-password").value = obfsPwd;
            } else if (ob.protocol === "wireguard") {
                document.getElementById("ob-wg-private-key").value = settingsObj.secretKey || "";
                document.getElementById("ob-wg-addresses").value = Array.isArray(settingsObj.address) ? settingsObj.address.join(", ") : (settingsObj.address || "");
                document.getElementById("ob-wg-reserved").value = Array.isArray(settingsObj.reserved) ? settingsObj.reserved.join(",") : "";
                
                const peer = settingsObj.peers ? settingsObj.peers[0] : null;
                if (peer) {
                    document.getElementById("ob-wg-peer-public-key").value = peer.publicKey || "";
                    document.getElementById("ob-wg-endpoint").value = peer.endpoint || "";
                }
                document.getElementById("ob-wg-mtu").value = settingsObj.mtu || "";
            }
            
            document.getElementById("ob-address").value = address;
            document.getElementById("ob-port").value = port;
            document.getElementById("ob-password").value = password;
        }
    } else {
        document.getElementById("outbound-modal-title").innerText = t("routing_modal_create_outbound", "Создание исходящего подключения");
        document.getElementById("ob-id").value = "";
        document.getElementById("ob-tag").disabled = false;
        document.getElementById("ob-enable").checked = true;
    }
    
    const btnWarp = document.getElementById("btn-generate-warp-profile");
    if (btnWarp && !btnWarp.dataset.bound) {
        btnWarp.dataset.bound = "true";
        btnWarp.addEventListener("click", async () => {
            btnWarp.disabled = true;
            btnWarp.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> ' + t("routing_warp_btn_registering", "Регистрация...");
            showToast(t("routing_warp_toast_registering", "Регистрация аккаунта Cloudflare WARP..."), "info");
            
            try {
                const res = await apiFetch("/api/routing/outbounds/generate-warp", { method: "POST" });
                if (res && res.success) {
                    const data = res.obj;
                    document.getElementById("ob-wg-private-key").value = data.private_key || "";
                    document.getElementById("ob-wg-addresses").value = `${data.address_v4 || ""}, ${data.address_v6 || ""}`.replace(/,\s*$/, "");
                    document.getElementById("ob-wg-reserved").value = (data.reserved || []).join(",");
                    document.getElementById("ob-wg-peer-public-key").value = data.peer_public_key || "";
                    document.getElementById("ob-wg-endpoint").value = data.endpoint || "";
                    document.getElementById("ob-wg-mtu").value = "1280";
                    showToast(t("routing_warp_toast_register_success", "Аккаунт Cloudflare WARP успешно сгенерирован!"));
                } else {
                    showToast(res ? res.msg : t("routing_warp_toast_register_error", "Не удалось сгенерировать WARP-профиль"), "error");
                }
            } catch (err) {
                showToast(t("routing_warp_toast_register_err_msg", "Ошибка генерации WARP: {error}").replace("{error}", err), "error");
            } finally {
                btnWarp.disabled = false;
                btnWarp.innerHTML = '<i class="fa-solid fa-cloud-bolt" style="margin-right: 4px;"></i>' + t("routing_warp_btn_generate", "Сгенерировать WARP");
            }
        });
    }

    updateOutboundFormFields();
    document.getElementById("outbound-modal").classList.add("active");
}

export async function toggleOutbound(id, checked) {
    const listRes = await apiFetch("/api/routing/outbounds");
    if (!listRes || !listRes.success) return;
    const ob = listRes.obj.find(x => x.id === id);
    if (!ob) return;
    
    let settingsObj = {};
    try {
        settingsObj = JSON.parse(ob.settings || "{}");
    } catch(e) {}
    
    const res = await apiFetch(`/api/routing/outbounds/update/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            remark: ob.remark,
            protocol: ob.protocol,
            tag: ob.tag,
            settings: settingsObj,
            enable: checked ? 1 : 0
        })
    });
    
    if (res && res.success) {
        showToast(checked ? t("routing_outbound_enabled", "Исходящее подключение включено") : t("routing_outbound_disabled", "Исходящее подключение выключено"));
        loadOutbounds();
    }
}

export async function deleteOutbound(id) {
    const confirmed = await showConfirmDialog(t("routing_confirm_delete_outbound", "Вы уверены, что хотите удалить это исходящее подключение? Любые правила маршрутизации, ссылающиеся на него, больше не будут работать."));
    if (!confirmed) return;
    
    const res = await apiFetch(`/api/routing/outbounds/delete/${id}`, { method: "POST" });
    if (res && res.success) {
        showToast(t("routing_outbound_deleted", "Исходящее подключение успешно удалено"));
        loadOutbounds();
        // Trigger routing rules reload in routing.js via event to avoid circular dependencies and dynamic import
        window.dispatchEvent(new CustomEvent("routing-rules-updated"));
    } else {
        showToast(res ? res.msg : "Error", "error");
    }
}

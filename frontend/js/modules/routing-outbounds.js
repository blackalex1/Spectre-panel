import { apiFetch } from "../api.js";
import { showToast, formatBytes } from "../ui.js";
import { t } from "../i18n.js";

// Global cache for loaded outbounds (used to populate outbound select dropdowns)
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
                
                const hs = streamSettingsObj.hysteriaSettings || {};
                password = hs.auth || "";
                
                const upRaw = hs.up || "";
                const downRaw = hs.down || "";
                document.getElementById("ob-up-mbps").value = upRaw ? parseInt(upRaw) : "";
                document.getElementById("ob-down-mbps").value = downRaw ? parseInt(downRaw) : "";
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
    if (!confirm(t("routing_confirm_delete_outbound", "Вы уверены, что хотите удалить это исходящее подключение? Любые правила маршрутизации, ссылающиеся на него, больше не будут работать."))) return;
    
    const res = await apiFetch(`/api/routing/outbounds/delete/${id}`, { method: "POST" });
    if (res && res.success) {
        showToast(t("routing_outbound_deleted", "Исходящее подключение успешно удалено"));
        loadOutbounds();
        // Since loadRoutingRules is defined in routing.js and imported, it is called externally.
        // We will trigger a refresh via custom event or direct call if we expose rules loading.
        const { loadRoutingRules } = await import("../routing.js");
        loadRoutingRules();
    } else {
        showToast(res ? res.msg : "Error", "error");
    }
}

export function updateOutboundFormFields() {
    const protocol = document.getElementById("ob-protocol").value;
    const proxyFields = document.getElementById("ob-proxy-fields");
    const ssMethodGroup = document.getElementById("ob-ss-method-group");
    const usernameField = document.getElementById("ob-username").parentElement;
    
    const securityFields = document.getElementById("ob-security-fields");
    const securityGroup = document.getElementById("ob-security-group");
    const realityFields = document.getElementById("ob-reality-fields");
    const alpnGroup = document.getElementById("ob-alpn-group");
    const flowGroup = document.getElementById("ob-flow-group");
    const encryptionGroup = document.getElementById("ob-encryption-group");
    
    const hysteriaFields = document.getElementById("ob-hysteria-fields");
    
    if (encryptionGroup) {
        encryptionGroup.style.display = (protocol === "vless") ? "block" : "none";
    }
    
    // Label for password field
    const passLabel = document.querySelector("label[for='ob-password']");
    if (passLabel) {
        if (protocol === "vless") {
            passLabel.innerText = "UUID";
        } else if (protocol === "hysteria") {
            passLabel.innerText = "Пароль (Auth)";
        } else {
            passLabel.innerText = t("routing_modal_password", "Пароль / Ключ");
        }
    }
    
    if (protocol === "socks" || protocol === "http" || protocol === "shadowsocks" || protocol === "vless" || protocol === "hysteria") {
        proxyFields.style.display = "block";
        
        if (protocol === "shadowsocks") {
            ssMethodGroup.style.display = "block";
            usernameField.style.display = "none";
            
            securityFields.style.display = "none";
            hysteriaFields.style.display = "none";
        } else if (protocol === "vless") {
            ssMethodGroup.style.display = "none";
            usernameField.style.display = "none";
            
            securityFields.style.display = "block";
            securityGroup.style.display = "block";
            
            const security = document.getElementById("ob-security").value;
            realityFields.style.display = (security === "reality") ? "block" : "none";
            alpnGroup.style.display = (security === "tls") ? "block" : "none";
            flowGroup.style.display = "block";
            
            hysteriaFields.style.display = "none";
        } else if (protocol === "hysteria") {
            ssMethodGroup.style.display = "none";
            usernameField.style.display = "none";
            
            securityFields.style.display = "block";
            securityGroup.style.display = "none"; // Hysteria always uses TLS
            realityFields.style.display = "none";
            alpnGroup.style.display = "block";
            flowGroup.style.display = "none";
            
            hysteriaFields.style.display = "block";
        } else {
            // SOCKS, HTTP
            ssMethodGroup.style.display = "none";
            usernameField.style.display = "block";
            
            securityFields.style.display = "none";
            hysteriaFields.style.display = "none";
            if (usernameField) usernameField.style.display = "block";
        }
    } else {
        proxyFields.style.display = "none";
        securityFields.style.display = "none";
        hysteriaFields.style.display = "none";
    }
}

export function parseProxyLink(link) {
    if (!link) return null;
    link = link.trim();
    
    function safeAtob(str) {
        str = str.trim();
        str = str.split('?')[0].split('/')[0];
        str = str.replace(/-/g, '+').replace(/_/g, '/');
        while (str.length % 4) {
            str += '=';
        }
        try {
            return atob(str);
        } catch (e) {
            return null;
        }
    }
    
    if (link.startsWith("vless://")) {
        const withoutScheme = link.substring(8);
        const hashSplit = withoutScheme.split('#');
        const mainPart = hashSplit[0];
        const remark = hashSplit[1] ? decodeURIComponent(hashSplit[1]) : "";
        
        // Split by ? first to isolate query string from userinfo and host/port
        const qSplit = mainPart.split('?');
        const credentialsAndHost = qSplit[0];
        const queryString = qSplit[1] || "";
        
        const atIndex = credentialsAndHost.indexOf('@');
        if (atIndex === -1) return null;
        const uuid = credentialsAndHost.substring(0, atIndex);
        const hostPort = credentialsAndHost.substring(atIndex + 1);
        
        const hpSplit = hostPort.split(':');
        const host = hpSplit[0];
        const port = hpSplit[1] ? parseInt(hpSplit[1]) : "";
        
        const params = new URLSearchParams(queryString);
        const security = params.get("security") || "none";
        const sni = params.get("sni") || "";
        const pbk = params.get("pbk") || "";
        const sid = params.get("sid") || params.get("shortId") || "";
        const fp = params.get("fp") || "chrome";
        const flow = params.get("flow") || "";
        const alpn = params.get("alpn") || "";
        const encryption = params.get("encryption") || "";
        
        return {
            protocol: "vless",
            remark,
            host,
            port,
            uuid,
            security,
            sni,
            pbk,
            sid,
            fp,
            flow,
            alpn,
            encryption
        };
    }
    
    if (link.startsWith("hysteria2://") || link.startsWith("hysteria://")) {
        const isHysteria2 = link.startsWith("hysteria2://");
        const schemeLen = isHysteria2 ? 12 : 11;
        const withoutScheme = link.substring(schemeLen);
        const hashSplit = withoutScheme.split('#');
        const mainPart = hashSplit[0];
        const remark = hashSplit[1] ? decodeURIComponent(hashSplit[1]) : "";
        
        // Split by ? first to isolate query string
        const qSplit = mainPart.split('?');
        const credentialsAndHost = qSplit[0];
        const queryString = qSplit[1] || "";
        
        let auth = "";
        let hostPort = credentialsAndHost;
        const atIndex = credentialsAndHost.indexOf('@');
        if (atIndex !== -1) {
            auth = credentialsAndHost.substring(0, atIndex);
            hostPort = credentialsAndHost.substring(atIndex + 1);
        }
        
        const hpSplit = hostPort.split(':');
        const host = hpSplit[0];
        const port = hpSplit[1] ? parseInt(hpSplit[1]) : "";
        
        const params = new URLSearchParams(queryString);
        const sni = params.get("sni") || params.get("peer") || "";
        const alpn = params.get("alpn") || "h3";
        
        let up = params.get("up") || "";
        let down = params.get("down") || "";
        if (up) up = parseInt(up);
        if (down) down = parseInt(down);
        
        return {
            protocol: "hysteria",
            remark,
            host,
            port,
            password: auth,
            sni,
            alpn,
            up,
            down
        };
    }
    
    if (link.startsWith("socks://") || link.startsWith("socks5://") || link.startsWith("http://")) {
        const isSocks5 = link.startsWith("socks5://");
        const isSocks = link.startsWith("socks://");
        const isHttp = link.startsWith("http://");
        const schemeLen = isSocks5 ? 9 : (isSocks ? 8 : 7);
        
        const withoutScheme = link.substring(schemeLen);
        const hashSplit = withoutScheme.split('#');
        const mainPart = hashSplit[0];
        const remark = hashSplit[1] ? decodeURIComponent(hashSplit[1]) : "";
        
        // Split by ? first to isolate query string
        const qSplit = mainPart.split('?');
        const credentialsAndHost = qSplit[0];
        
        let userPass = "";
        let hostPort = credentialsAndHost;
        const atIndex = credentialsAndHost.indexOf('@');
        if (atIndex !== -1) {
            userPass = credentialsAndHost.substring(0, atIndex);
            hostPort = credentialsAndHost.substring(atIndex + 1);
        }
        
        const hpSplit = hostPort.split(':');
        const host = hpSplit[0];
        const port = hpSplit[1] ? parseInt(hpSplit[1]) : "";
        
        let username = "";
        let password = "";
        if (userPass) {
            const upSplit = userPass.split(':');
            username = upSplit[0] || "";
            password = upSplit[1] || "";
        }
        
        return {
            protocol: isHttp ? "http" : "socks",
            remark,
            host,
            port,
            username,
            password
        };
    }
    
    if (link.startsWith("ss://")) {
        const withoutScheme = link.substring(5);
        const hashSplit = withoutScheme.split('#');
        const mainPart = hashSplit[0];
        const remark = hashSplit[1] ? decodeURIComponent(hashSplit[1]) : "";
        
        // Split by ? first to isolate query string
        const qSplit = mainPart.split('?');
        const credentialsAndHost = qSplit[0];
        
        let method = "";
        let password = "";
        let host = "";
        let port = "";
        
        if (credentialsAndHost.includes('@')) {
            const atIndex = credentialsAndHost.lastIndexOf('@');
            const userinfoBase64 = credentialsAndHost.substring(0, atIndex);
            const hostPort = credentialsAndHost.substring(atIndex + 1);
            
            const userinfo = safeAtob(userinfoBase64);
            if (userinfo) {
                const upSplit = userinfo.split(':');
                method = upSplit[0] || "";
                password = upSplit[1] || "";
            }
            
            const hpSplit = hostPort.split(':');
            host = hpSplit[0] || "";
            port = hpSplit[1] ? parseInt(hpSplit[1]) : "";
        } else {
            const decoded = safeAtob(credentialsAndHost);
            if (decoded && decoded.includes('@')) {
                const atIndex = decoded.lastIndexOf('@');
                const userinfo = decoded.substring(0, atIndex);
                const upSplit = userinfo.split(':');
                method = upSplit[0] || "";
                password = upSplit[1] || "";
                
                const hostPort = decoded.substring(atIndex + 1);
                const hpSplit = hostPort.split(':');
                host = hpSplit[0] || "";
                port = hpSplit[1] ? parseInt(hpSplit[1]) : "";
            }
        }
        
        if (host && port) {
            return {
                protocol: "shadowsocks",
                remark,
                host,
                port,
                password,
                method
            };
        }
    }
    
    return null;
}

export function validateOutboundForm() {
    let isValid = true;
    const errors = [];
    
    // Clear previous validation styling
    const inputs = document.querySelectorAll("#outbound-form input, #outbound-form select, #outbound-form textarea");
    inputs.forEach(el => el.classList.remove("input-invalid"));
    
    const remark = document.getElementById("ob-remark");
    if (remark && (!remark.value || !remark.value.trim())) {
        remark.classList.add("input-invalid");
        errors.push(t("validation_outbound_remark_required", "Описание исходящего подключения обязательно"));
        isValid = false;
    }
    
    const tag = document.getElementById("ob-tag");
    if (tag && (!tag.value || !tag.value.trim())) {
        tag.classList.add("input-invalid");
        errors.push(t("validation_outbound_tag_required", "Тег исходящего подключения обязателен"));
        isValid = false;
    }
    
    const protocol = document.getElementById("ob-protocol").value;
    if (protocol === "socks" || protocol === "http" || protocol === "shadowsocks" || protocol === "vless" || protocol === "hysteria") {
        const address = document.getElementById("ob-address");
        if (address && (!address.value || !address.value.trim())) {
            address.classList.add("input-invalid");
            errors.push(t("validation_outbound_address_required", "Адрес сервера обязателен"));
            isValid = false;
        }
        
        const port = document.getElementById("ob-port");
        if (port) {
            const portVal = parseInt(port.value);
            if (isNaN(portVal) || portVal < 1 || portVal > 65535) {
                port.classList.add("input-invalid");
                errors.push(t("validation_outbound_port_invalid", "Порт должен быть числом от 1 до 65535"));
                isValid = false;
            }
        }
        
        if (protocol === "shadowsocks" || protocol === "vless" || protocol === "hysteria") {
            const password = document.getElementById("ob-password");
            if (password && (!password.value || !password.value.trim())) {
                password.classList.add("input-invalid");
                if (protocol === "vless") {
                    errors.push(t("validation_outbound_uuid_required", "UUID обязателен"));
                } else if (protocol === "hysteria") {
                    errors.push(t("validation_outbound_auth_required", "Пароль (Auth) обязателен"));
                } else {
                    errors.push(t("validation_outbound_password_required", "Пароль / Ключ обязателен"));
                }
                isValid = false;
            }
        }
        
        if (protocol === "vless") {
            const security = document.getElementById("ob-security").value;
            if (security === "reality" || security === "tls") {
                const sni = document.getElementById("ob-sni");
                if (sni && (!sni.value || !sni.value.trim())) {
                    sni.classList.add("input-invalid");
                    errors.push(t("validation_outbound_sni_required", "SNI / ServerName обязателен"));
                    isValid = false;
                }
            }
            if (security === "reality") {
                const pbk = document.getElementById("ob-pbk");
                const shortid = document.getElementById("ob-shortid");
                
                if (pbk && (!pbk.value || !pbk.value.trim())) {
                    pbk.classList.add("input-invalid");
                    errors.push(t("validation_outbound_pbk_required", "Публичный ключ Reality обязателен"));
                    isValid = false;
                }
                if (shortid && (!shortid.value || !shortid.value.trim())) {
                    shortid.classList.add("input-invalid");
                    errors.push(t("validation_outbound_shortid_required", "Short ID Reality обязателен"));
                    isValid = false;
                }
            }
        } else if (protocol === "hysteria") {
            const sni = document.getElementById("ob-sni");
            if (sni && (!sni.value || !sni.value.trim())) {
                sni.classList.add("input-invalid");
                errors.push(t("validation_outbound_sni_required", "SNI / ServerName обязателен"));
                isValid = false;
            }
        }
    }
    
    if (!isValid && errors.length > 0) {
        showToast(errors[0], "error");
    }
    return isValid;
}


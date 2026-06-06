import { apiFetch } from "../api.js";
import { showToast } from "../ui.js";
import { t } from "../i18n.js";
import {
    compileXraySecuritySettings,
    populateXraySecuritySettings,
    compileXrayTransportSettings,
    populateXrayTransportSettings
} from "./inbound-protocols.js";

export let editInboundId = null;
export let originalClients = [];

export function setEditInboundId(val) {
    editInboundId = val;
}

export function generateRandomPassword(length = 16) {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let password = "";
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

export function updateFormToggles() {
    const proto = document.getElementById("ib-protocol").value;
    const network = document.getElementById("ib-network").value;
    const security = document.getElementById("ib-security").value;
    
    const xrayRow = document.getElementById("xray-network-security-row");
    const sniffingGroup = document.getElementById("ib-sniffing-group");
    const realityGroup = document.getElementById("reality-settings-group");
    const tlsGroup = document.getElementById("tls-settings-group");
    const wsGroup = document.getElementById("ws-settings-group");
    const grpcGroup = document.getElementById("grpc-settings-group");
    const tcpGroup = document.getElementById("tcp-settings-group");
    const h2Group = document.getElementById("h2-settings-group");
    const mkcpGroup = document.getElementById("mkcp-settings-group");
    const ssGroup = document.getElementById("shadowsocks-settings-group");
    const hysteriaGroup = document.getElementById("hysteria-settings-group");
    const fallbacksGroup = document.getElementById("fallbacks-settings-group");
    const vlessProtoGroup = document.getElementById("vless-protocol-settings-group");
    
    // Toggle Sniffing Overrides display
    const sniffingChecked = document.getElementById("ib-sniffing").checked;
    const sniffingOverrides = document.getElementById("sniffing-overrides");
    if (sniffingOverrides) {
        sniffingOverrides.style.display = sniffingChecked ? "flex" : "none";
    }
    
    if (vlessProtoGroup) {
        vlessProtoGroup.style.display = (proto === "vless") ? "block" : "none";
    }
    
    if (proto === "vless" || proto === "vmess" || proto === "trojan") {
        if (xrayRow) xrayRow.style.display = "block";
        if (sniffingGroup) sniffingGroup.style.display = "block";
        if (ssGroup) ssGroup.style.display = "none";
        if (hysteriaGroup) hysteriaGroup.style.display = "none";
        
        if (realityGroup) realityGroup.style.display = (security === "reality") ? "block" : "none";
        if (tlsGroup) tlsGroup.style.display = (security === "tls") ? "block" : "none";
        
        // Transport settings subgroups
        if (tcpGroup) tcpGroup.style.display = (network === "tcp") ? "block" : "none";
        if (wsGroup) wsGroup.style.display = (network === "ws") ? "block" : "none";
        if (grpcGroup) grpcGroup.style.display = (network === "grpc") ? "block" : "none";
        if (h2Group) h2Group.style.display = (network === "h2") ? "block" : "none";
        if (mkcpGroup) mkcpGroup.style.display = (network === "mkcp") ? "block" : "none";
        
        // TCP HTTP masquerade fields toggle
        if (network === "tcp") {
            const tcpType = document.getElementById("ib-tcp-type").value;
            const tcpHttp = document.getElementById("tcp-http-settings");
            if (tcpHttp) tcpHttp.style.display = (tcpType === "http") ? "block" : "none";
        }
        
        // Fallbacks settings display
        if (fallbacksGroup) fallbacksGroup.style.display = (proto === "vless" || proto === "trojan") ? "block" : "none";
        
        // Custom security restrictions
        if (proto === "vmess" || proto === "trojan") {
            const realityOption = document.querySelector("#ib-security option[value='reality']");
            if (realityOption) {
                if (security === "reality") {
                    document.getElementById("ib-security").value = "tls";
                    if (realityGroup) realityGroup.style.display = "none";
                    if (tlsGroup) tlsGroup.style.display = "block";
                }
                realityOption.disabled = true;
            }
        } else {
            const realityOption = document.querySelector("#ib-security option[value='reality']");
            if (realityOption) realityOption.disabled = false;
        }
    } else if (proto === "shadowsocks") {
        if (xrayRow) xrayRow.style.display = "none";
        if (sniffingGroup) sniffingGroup.style.display = "none";
        if (realityGroup) realityGroup.style.display = "none";
        if (tlsGroup) tlsGroup.style.display = "none";
        if (tcpGroup) tcpGroup.style.display = "none";
        if (wsGroup) wsGroup.style.display = "none";
        if (grpcGroup) grpcGroup.style.display = "none";
        if (h2Group) h2Group.style.display = "none";
        if (mkcpGroup) mkcpGroup.style.display = "none";
        if (ssGroup) ssGroup.style.display = "block";
        if (hysteriaGroup) hysteriaGroup.style.display = "none";
        if (fallbacksGroup) fallbacksGroup.style.display = "none";
    } else if (proto === "hysteria2") {
        if (xrayRow) xrayRow.style.display = "none";
        if (sniffingGroup) sniffingGroup.style.display = "none";
        if (realityGroup) realityGroup.style.display = "none";
        if (tlsGroup) tlsGroup.style.display = "none";
        if (tcpGroup) tcpGroup.style.display = "none";
        if (wsGroup) wsGroup.style.display = "none";
        if (grpcGroup) grpcGroup.style.display = "none";
        if (h2Group) h2Group.style.display = "none";
        if (mkcpGroup) mkcpGroup.style.display = "none";
        if (ssGroup) ssGroup.style.display = "none";
        if (hysteriaGroup) hysteriaGroup.style.display = "block";
        if (fallbacksGroup) fallbacksGroup.style.display = "none";
        
        // Hysteria 2 TLS cert mode toggle
        const certMode = document.getElementById("ib-hysteria-cert-mode").value;
        const certFields = document.getElementById("hysteria-custom-cert-fields");
        if (certFields) certFields.style.display = (certMode === "custom") ? "block" : "none";

        // Hysteria 2 Mode (masq vs obfs) toggle
        const hystMode = document.getElementById("ib-hysteria-mode").value;
        const obfsGroup = document.getElementById("hysteria-obfs-group");
        const masqGroup = document.getElementById("hysteria-masq-group");
        if (obfsGroup) obfsGroup.style.display = (hystMode === "obfs") ? "block" : "none";
        if (masqGroup) masqGroup.style.display = (hystMode === "masq") ? "block" : "none";
    }
}

export function updateTabVisibility(proto) {
    const tabProtocol = document.getElementById("ib-tab-protocol");
    const tabStream = document.getElementById("ib-tab-stream");
    const tabSecurity = document.getElementById("ib-tab-security");
    const tabSniffing = document.getElementById("ib-tab-sniffing");
    
    if (!tabProtocol || !tabStream || !tabSecurity || !tabSniffing) return;
    
    if (proto === "vless" || proto === "vmess" || proto === "trojan") {
        tabProtocol.style.display = "inline-block";
        tabStream.style.display = "inline-block";
        tabSecurity.style.display = "inline-block";
        tabSniffing.style.display = "inline-block";
    } else if (proto === "shadowsocks") {
        tabProtocol.style.display = "inline-block";
        tabStream.style.display = "none";
        tabSecurity.style.display = "none";
        tabSniffing.style.display = "none";
    } else if (proto === "hysteria2") {
        tabProtocol.style.display = "none";
        tabStream.style.display = "inline-block";
        tabSecurity.style.display = "none";
        tabSniffing.style.display = "none";
    }
    
    // Auto switch to Basic if current active tab is hidden
    const activeTabButton = document.querySelector(".modal-tab-btn.active");
    if (activeTabButton) {
        const activeTab = activeTabButton.getAttribute("data-tab");
        const targetBtn = document.querySelector(`.modal-tab-btn[data-tab='${activeTab}']`);
        if (targetBtn && targetBtn.style.display === "none") {
            switchInboundModalTab("basic");
        }
    }
}

export function handleProtocolChange(proto) {
    const networkSelect = document.getElementById("ib-network");
    const securitySelect = document.getElementById("ib-security");
    
    if (proto === "vless") {
        networkSelect.value = "tcp";
        securitySelect.value = "reality";
    } else if (proto === "vmess") {
        networkSelect.value = "ws";
        securitySelect.value = "none";
    } else if (proto === "trojan") {
        networkSelect.value = "tcp";
        securitySelect.value = "tls";
    } else if (proto === "hysteria2") {
        const obfsInput = document.getElementById("ib-hysteria-obfs-password");
        if (obfsInput && !obfsInput.value && !editInboundId) {
            obfsInput.value = generateRandomPassword(16);
        }
    }
    updateFormToggles();
    updateTabVisibility(proto);
}

export function serializeFormToJson() {
    const remark = document.getElementById("ib-remark").value;
    const port = parseInt(document.getElementById("ib-port").value) || 0;
    const protocol = document.getElementById("ib-protocol").value;
    
    const totalGB = parseFloat(document.getElementById("ib-total").value) || 0;
    const total = totalGB * 1024 * 1024 * 1024;
    
    const expiryTimeInput = document.getElementById("ib-expiry-time").value;
    let expiryTime = 0;
    if (expiryTimeInput) {
        expiryTime = new Date(expiryTimeInput).getTime();
    }
    
    let settings = { clients: originalClients };
    if (protocol === "vless") {
        settings.decryption = document.getElementById("ib-vless-decryption").value || "none";
        settings.encryption = document.getElementById("ib-vless-encryption").value || "none";
    }
    let streamSettings = {};
    let sniffing = { enabled: false, destOverride: [] };
    
    if (protocol === "vless" || protocol === "vmess" || protocol === "trojan") {
        const network = document.getElementById("ib-network").value;
        const security = document.getElementById("ib-security").value;
        const isSniffingEnabled = document.getElementById("ib-sniffing").checked;
        
        if (isSniffingEnabled) {
            const dests = [];
            if (document.getElementById("ib-sniffing-http").checked) dests.push("http");
            if (document.getElementById("ib-sniffing-tls").checked) dests.push("tls");
            if (document.getElementById("ib-sniffing-quic").checked) dests.push("quic");
            if (document.getElementById("ib-sniffing-fakedns").checked) dests.push("fakedns");
            
            sniffing = {
                enabled: true,
                destOverride: dests,
                routeOnly: document.getElementById("ib-sniffing-routeonly").checked
            };
        }
        
        streamSettings = {
            network: network,
            security: security
        };
        
        compileXraySecuritySettings(security, streamSettings);
        compileXrayTransportSettings(network, streamSettings);
        
        // Fallbacks
        if (protocol === "vless" || protocol === "trojan") {
            const fallbackDest = document.getElementById("ib-fallback-dest").value || "";
            if (fallbackDest) {
                const fallbackPath = document.getElementById("ib-fallback-path").value || "";
                const fallbackXver = parseInt(document.getElementById("ib-fallback-xver").value) || 0;
                const fallbackAlpn = document.getElementById("ib-fallback-alpn").value || "";
                
                const fallback = {
                    dest: fallbackDest.includes(":") ? fallbackDest : parseInt(fallbackDest) || fallbackDest,
                    xver: fallbackXver
                };
                if (fallbackPath) fallback.path = fallbackPath;
                if (fallbackAlpn) fallback.alpn = fallbackAlpn;
                
                settings.fallbacks = [fallback];
            }
        }
    } else if (protocol === "shadowsocks") {
        const method = document.getElementById("ib-ss-method").value;
        settings = {
            method: method,
            clients: originalClients,
            network: "tcp,udp"
        };
    } else if (protocol === "hysteria2") {
        const hystMode = document.getElementById("ib-hysteria-mode").value || "masq";
        const obfsPassword = hystMode === "obfs" ? (document.getElementById("ib-hysteria-obfs-password").value || "") : "";
        const upMbps = parseInt(document.getElementById("ib-hysteria-up-mbps").value) || 0;
        const downMbps = parseInt(document.getElementById("ib-hysteria-down-mbps").value) || 0;
        
        const certMode = document.getElementById("ib-hysteria-cert-mode").value || "self";
        const certPath = document.getElementById("ib-hysteria-cert-path").value || "";
        const keyPath = document.getElementById("ib-hysteria-key-path").value || "";
        const masqType = hystMode === "masq" ? (document.getElementById("ib-hysteria-masq-type").value || "proxy") : "";
        const masqValue = hystMode === "masq" ? (document.getElementById("ib-hysteria-masq-value").value || "") : "";
        const hop = document.getElementById("ib-hysteria-hop").value || "";
        const routingViaXray = document.getElementById("ib-hysteria-routing-xray").checked;
        
        streamSettings = {
            hysteria: {
                obfsPassword: obfsPassword,
                upMbps: upMbps,
                downMbps: downMbps,
                certMode: certMode,
                certPath: certPath,
                keyPath: keyPath,
                masqType: masqType,
                masqValue: masqValue,
                hop: hop,
                routingViaXray: routingViaXray
            }
        };
    }
    
    return {
        remark,
        port,
        protocol,
        settings,
        streamSettings,
        sniffing,
        total,
        expiryTime
    };
}

export function populateFormFromJson(payload) {
    if (!payload || typeof payload !== "object") return;
    
    if (payload.remark !== undefined) {
        document.getElementById("ib-remark").value = payload.remark || "";
    }
    if (payload.port !== undefined) {
        document.getElementById("ib-port").value = payload.port || 0;
    }
    if (payload.protocol !== undefined) {
        const protoSelect = document.getElementById("ib-protocol");
        protoSelect.value = payload.protocol || "vless";
        handleProtocolChange(payload.protocol);
    }
    
    // Total & Expiry Time
    if (payload.total !== undefined) {
        document.getElementById("ib-total").value = payload.total ? (payload.total / (1024 * 1024 * 1024)) : 0;
    }
    if (payload.expiryTime !== undefined) {
        if (payload.expiryTime > 0) {
            const date = new Date(payload.expiryTime);
            const pad = (num) => String(num).padStart(2, '0');
            const formatted = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
            document.getElementById("ib-expiry-time").value = formatted;
        } else {
            document.getElementById("ib-expiry-time").value = "";
        }
    }
    
    const settings = payload.settings || {};
    const streamSettings = payload.streamSettings || {};
    const sniffing = payload.sniffing || {};
    const protocol = payload.protocol || "vless";
    
    if (protocol === "vless" || protocol === "vmess" || protocol === "trojan") {
        if (protocol === "vless") {
            document.getElementById("ib-vless-decryption").value = settings.decryption || "none";
            document.getElementById("ib-vless-encryption").value = settings.encryption || "none";
        } else {
            document.getElementById("ib-vless-decryption").value = "none";
            document.getElementById("ib-vless-encryption").value = "none";
        }
        if (streamSettings.network !== undefined) {
            document.getElementById("ib-network").value = streamSettings.network || "tcp";
        }
        if (streamSettings.security !== undefined) {
            document.getElementById("ib-security").value = streamSettings.security || "none";
        }
        
        // Sniffing
        const sniffingChecked = sniffing.enabled || false;
        document.getElementById("ib-sniffing").checked = sniffingChecked;
        
        document.getElementById("ib-sniffing-http").checked = false;
        document.getElementById("ib-sniffing-tls").checked = false;
        document.getElementById("ib-sniffing-quic").checked = false;
        document.getElementById("ib-sniffing-fakedns").checked = false;
        document.getElementById("ib-sniffing-routeonly").checked = false;
        
        if (sniffingChecked) {
            const dests = sniffing.destOverride || [];
            document.getElementById("ib-sniffing-http").checked = dests.includes("http");
            document.getElementById("ib-sniffing-tls").checked = dests.includes("tls");
            document.getElementById("ib-sniffing-quic").checked = dests.includes("quic");
            document.getElementById("ib-sniffing-fakedns").checked = dests.includes("fakedns");
            document.getElementById("ib-sniffing-routeonly").checked = sniffing.routeOnly || false;
        }
        
        populateXraySecuritySettings(streamSettings.security || "none", streamSettings);
        populateXrayTransportSettings(streamSettings.network || "tcp", streamSettings);
        
        // Fallbacks
        if (protocol === "vless" || protocol === "trojan") {
            const fallbacks = settings.fallbacks || [];
            if (fallbacks.length > 0) {
                const f = fallbacks[0];
                document.getElementById("ib-fallback-dest").value = f.dest || "";
                document.getElementById("ib-fallback-path").value = f.path || "";
                document.getElementById("ib-fallback-xver").value = f.xver || 0;
                document.getElementById("ib-fallback-alpn").value = f.alpn || "";
            } else {
                document.getElementById("ib-fallback-dest").value = "";
                document.getElementById("ib-fallback-path").value = "";
                document.getElementById("ib-fallback-xver").value = 0;
                document.getElementById("ib-fallback-alpn").value = "";
            }
        }
    } else if (protocol === "shadowsocks") {
        document.getElementById("ib-ss-method").value = settings.method || "aes-256-gcm";
    } else if (protocol === "hysteria2") {
        const ho = streamSettings.hysteria || {};
        const hystMode = ho.obfsPassword ? "obfs" : "masq";
        document.getElementById("ib-hysteria-mode").value = hystMode;
        
        document.getElementById("ib-hysteria-obfs-password").value = ho.obfsPassword || "";
        document.getElementById("ib-hysteria-up-mbps").value = ho.upMbps || 100;
        document.getElementById("ib-hysteria-down-mbps").value = ho.downMbps || 100;
        document.getElementById("ib-hysteria-cert-mode").value = ho.certMode || "self";
        document.getElementById("ib-hysteria-cert-path").value = ho.certPath || "";
        document.getElementById("ib-hysteria-key-path").value = ho.keyPath || "";
        document.getElementById("ib-hysteria-masq-type").value = ho.masqType || "proxy";
        document.getElementById("ib-hysteria-masq-value").value = ho.masqValue || "";
        document.getElementById("ib-hysteria-hop").value = ho.hop || "";
        document.getElementById("ib-hysteria-routing-xray").checked = ho.routingViaXray || false;
    }
    
    if (settings.clients) {
        originalClients = settings.clients;
    }
    
    updateFormToggles();
}

export function switchInboundModalTab(tabName) {
    const tabButtons = document.querySelectorAll(".modal-tab-btn");
    const tabPanels = document.querySelectorAll(".tab-panel");
    
    let activeTabButton = document.querySelector(".modal-tab-btn.active");
    let currentTab = activeTabButton ? activeTabButton.getAttribute("data-tab") : "basic";
    
    if (currentTab === "advanced" && tabName !== "advanced") {
        const jsonEditor = document.getElementById("ib-json-editor");
        try {
            const parsed = JSON.parse(jsonEditor.value);
            populateFormFromJson(parsed);
        } catch (err) {
            showToast(t("invalid_json_toast", "Неверный формат JSON!") + " " + err.message, "error");
            return false;
        }
    }
    
    if (tabName === "advanced" && currentTab !== "advanced") {
        const payload = serializeFormToJson();
        document.getElementById("ib-json-editor").value = JSON.stringify(payload, null, 2);
    }
    
    tabButtons.forEach(btn => {
        if (btn.getAttribute("data-tab") === tabName) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });
    
    tabPanels.forEach(panel => {
        if (panel.id === `tab-panel-${tabName}`) {
            panel.style.display = "block";
            panel.classList.add("active-panel");
        } else {
            panel.style.display = "none";
            panel.classList.remove("active-panel");
        }
    });
    
    return true;
}

export function validateInboundForm() {
    let isValid = true;
    const errors = [];
    
    // Clear previous validation styling
    const inputs = document.querySelectorAll("#inbound-form input, #inbound-form select, #inbound-form textarea");
    inputs.forEach(el => el.classList.remove("input-invalid"));
    
    const remark = document.getElementById("ib-remark");
    if (remark && (!remark.value || !remark.value.trim())) {
        remark.classList.add("input-invalid");
        errors.push(t("validation_inbound_remark_required", "Название подключения обязательно"));
        isValid = false;
    }
    
    const port = document.getElementById("ib-port");
    if (port) {
        const portVal = parseInt(port.value);
        if (isNaN(portVal) || portVal < 1 || portVal > 65535) {
            port.classList.add("input-invalid");
            errors.push(t("validation_inbound_port_invalid", "Порт должен быть числом от 1 до 65535"));
            isValid = false;
        }
    }
    
    const proto = document.getElementById("ib-protocol").value;
    if (proto === "vless" || proto === "vmess" || proto === "trojan") {
        const security = document.getElementById("ib-security").value;
        if (security === "reality") {
            const priv = document.getElementById("ib-reality-priv");
            const pbk = document.getElementById("ib-reality-pbk");
            const dest = document.getElementById("ib-reality-dest");
            
            if (priv && (!priv.value || !priv.value.trim())) {
                priv.classList.add("input-invalid");
                errors.push(t("validation_inbound_reality_priv_required", "Приватный ключ Reality обязателен"));
                isValid = false;
            }
            if (pbk && (!pbk.value || !pbk.value.trim())) {
                pbk.classList.add("input-invalid");
                errors.push(t("validation_inbound_reality_pbk_required", "Публичный ключ Reality обязателен"));
                isValid = false;
            }
            if (dest && (!dest.value || !dest.value.trim())) {
                dest.classList.add("input-invalid");
                errors.push(t("validation_inbound_reality_dest_required", "Направление маскировки Reality обязательно"));
                isValid = false;
            }
        }
    } else if (proto === "hysteria2") {
        const hystMode = document.getElementById("ib-hysteria-mode").value || "masq";
        if (hystMode === "obfs") {
            const obfs = document.getElementById("ib-hysteria-obfs-password");
            if (obfs && (!obfs.value || !obfs.value.trim())) {
                obfs.classList.add("input-invalid");
                errors.push(t("validation_inbound_hysteria_obfs_required", "Пароль обфускации Hysteria 2 обязателен"));
                isValid = false;
            }
        }
        
        const certMode = document.getElementById("ib-hysteria-cert-mode").value;
        if (certMode === "custom") {
            const certPath = document.getElementById("ib-hysteria-cert-path");
            const keyPath = document.getElementById("ib-hysteria-key-path");
            
            if (certPath && (!certPath.value || !certPath.value.trim())) {
                certPath.classList.add("input-invalid");
                errors.push(t("validation_inbound_hysteria_cert_required", "Путь к файлу сертификата обязателен"));
                isValid = false;
            }
            if (keyPath && (!keyPath.value || !keyPath.value.trim())) {
                keyPath.classList.add("input-invalid");
                errors.push(t("validation_inbound_hysteria_key_required", "Путь к приватному ключу обязателен"));
                isValid = false;
            }
        }
    }
    
    if (!isValid && errors.length > 0) {
        showToast(errors[0], "error"); // Show first error
        
        // Find the first invalid element and switch to its containing tab panel
        const firstInvalid = document.querySelector("#inbound-form .input-invalid");
        if (firstInvalid) {
            const panel = firstInvalid.closest(".tab-panel");
            if (panel) {
                const tabName = panel.id.replace("tab-panel-", "");
                switchInboundModalTab(tabName);
            }
        }
    }
    return isValid;
}

export async function handleInboundFormSubmit(e, loadInboundsCallback) {
    e.preventDefault();
    
    const advancedTabActive = document.querySelector(".modal-tab-btn[data-tab='advanced']").classList.contains("active");
    
    let payload;
    if (advancedTabActive) {
        const jsonEditor = document.getElementById("ib-json-editor");
        try {
            payload = JSON.parse(jsonEditor.value);
        } catch (err) {
            showToast(t("invalid_json_toast", "Неверный формат JSON!") + " " + err.message, "error");
            return;
        }
    } else {
        if (!validateInboundForm()) {
            return;
        }
        payload = serializeFormToJson();
    }
    
    // Preserving clients
    if (editInboundId !== null) {
        payload.settings.clients = originalClients;
    }
    
    const { remark, port, protocol, settings, streamSettings, sniffing, total, expiryTime } = payload;
    
    let res;
    if (editInboundId !== null) {
        res = await apiFetch(`/panel/api/inbounds/update/${editInboundId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ remark, port, protocol, settings, streamSettings, sniffing, enable: 1, total, expiryTime })
        });
    } else {
        res = await apiFetch("/api/inbounds/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ remark, port, protocol, settings, streamSettings, sniffing, total, expiryTime })
        });
    }
    
    if (res && res.success) {
        document.getElementById("inbound-modal").classList.remove("active");
        if (editInboundId !== null) {
            showToast(t("inbound_updated_toast", "Подключение успешно обновлено!"));
            editInboundId = null;
        } else {
            showToast(t("inbound_created_toast", "Подключение успешно создано!"));
        }
        loadInboundsCallback();
    } else {
        const errMsg = editInboundId !== null 
            ? (res ? res.msg : t("inbound_update_error_toast", "Ошибка обновления подключения"))
            : (res ? res.msg : t("inbound_create_error_toast", "Ошибка создания подключения"));
        showToast(errMsg, "error");
    }
}

export async function openEditInboundModal(id) {
    const listRes = await apiFetch("/panel/api/inbounds/list");
    if (!listRes || !listRes.success) return;
    const target = listRes.obj.find(x => x.id === id);
    if (!target) return;
    
    editInboundId = id;
    
    document.getElementById("ib-remark").value = target.remark;
    document.getElementById("ib-port").value = target.port;
    
    const protoSelect = document.getElementById("ib-protocol");
    protoSelect.value = target.protocol;
    protoSelect.disabled = true; // Lock protocol editing
    
    document.getElementById("inbound-modal-title").innerText = t("inbound_edit_title", "Редактирование подключения");
    document.querySelector("#inbound-form button[type='submit']").innerText = t("client_btn_save", "Сохранить");
    
    const settings = JSON.parse(target.settings || "{}");
    const streamSettings = JSON.parse(target.streamSettings || "{}");
    const sniffing = JSON.parse(target.sniffing || "{}");
    
    originalClients = settings.clients || [];
    
    // Expiry and total limits
    document.getElementById("ib-total").value = target.total ? (target.total / (1024 * 1024 * 1024)) : 0;
    if (target.expiryTime > 0) {
        const date = new Date(target.expiryTime);
        const pad = (num) => String(num).padStart(2, '0');
        const formatted = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
        document.getElementById("ib-expiry-time").value = formatted;
    } else {
        document.getElementById("ib-expiry-time").value = "";
    }
    
    handleProtocolChange(target.protocol);
    
    if (target.protocol === "vless" || target.protocol === "vmess" || target.protocol === "trojan") {
        document.getElementById("ib-network").value = streamSettings.network || "tcp";
        document.getElementById("ib-security").value = streamSettings.security || "none";
        
        const sniffingChecked = sniffing.enabled || false;
        document.getElementById("ib-sniffing").checked = sniffingChecked;
        
        document.getElementById("ib-sniffing-http").checked = false;
        document.getElementById("ib-sniffing-tls").checked = false;
        document.getElementById("ib-sniffing-quic").checked = false;
        document.getElementById("ib-sniffing-fakedns").checked = false;
        document.getElementById("ib-sniffing-routeonly").checked = false;
        
        if (sniffingChecked) {
            const dests = sniffing.destOverride || [];
            document.getElementById("ib-sniffing-http").checked = dests.includes("http");
            document.getElementById("ib-sniffing-tls").checked = dests.includes("tls");
            document.getElementById("ib-sniffing-quic").checked = dests.includes("quic");
            document.getElementById("ib-sniffing-fakedns").checked = dests.includes("fakedns");
            document.getElementById("ib-sniffing-routeonly").checked = sniffing.routeOnly || false;
        }
        
        populateXraySecuritySettings(streamSettings.security, streamSettings);
        populateXrayTransportSettings(streamSettings.network, streamSettings);
        
        if (target.protocol === "vless" || target.protocol === "trojan") {
            const fallbacks = settings.fallbacks || [];
            if (fallbacks.length > 0) {
                const f = fallbacks[0];
                document.getElementById("ib-fallback-dest").value = f.dest || "";
                document.getElementById("ib-fallback-path").value = f.path || "";
                document.getElementById("ib-fallback-xver").value = f.xver || 0;
                document.getElementById("ib-fallback-alpn").value = f.alpn || "";
            } else {
                document.getElementById("ib-fallback-dest").value = "";
                document.getElementById("ib-fallback-path").value = "";
                document.getElementById("ib-fallback-xver").value = 0;
                document.getElementById("ib-fallback-alpn").value = "";
            }
        }
    } else if (target.protocol === "shadowsocks") {
        document.getElementById("ib-ss-method").value = settings.method || "aes-256-gcm";
    } else if (target.protocol === "hysteria2") {
        const ho = streamSettings.hysteria || {};
        const hystMode = ho.obfsPassword ? "obfs" : "masq";
        document.getElementById("ib-hysteria-mode").value = hystMode;
        
        document.getElementById("ib-hysteria-obfs-password").value = ho.obfsPassword || "";
        document.getElementById("ib-hysteria-up-mbps").value = ho.upMbps || 0;
        document.getElementById("ib-hysteria-down-mbps").value = ho.downMbps || 0;
        document.getElementById("ib-hysteria-cert-mode").value = ho.certMode || "self";
        document.getElementById("ib-hysteria-cert-path").value = ho.certPath || "";
        document.getElementById("ib-hysteria-key-path").value = ho.keyPath || "";
        document.getElementById("ib-hysteria-masq-type").value = ho.masqType || "proxy";
        document.getElementById("ib-hysteria-masq-value").value = ho.masqValue || "";
        document.getElementById("ib-hysteria-hop").value = ho.hop || "";
        document.getElementById("ib-hysteria-routing-xray").checked = ho.routingViaXray || false;
    }
    
    switchInboundModalTab("basic");
    document.getElementById("inbound-modal").classList.add("active");
}


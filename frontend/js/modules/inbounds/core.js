import { apiFetch } from "../../api.js";
import { showToast } from "../../ui.js";
import { t } from "../../i18n.js";
import {
    compileXraySecuritySettings,
    populateXraySecuritySettings,
    compileXrayTransportSettings,
    populateXrayTransportSettings
} from "../inbound-protocols.js";
import { updateFormToggles, handleProtocolChange } from "./toggles.js";
import { validateInboundForm } from "./validation.js";

export let editInboundId = null;
export let originalClients = [];

export function setEditInboundId(val) {
    editInboundId = val;
}

export function setOriginalClients(val) {
    originalClients = val;
}

export function generateRandomPassword(length = 16) {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let password = "";
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
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
        const ignoreClientBandwidth = document.getElementById("ib-hysteria-ignore-bw").checked;
        const hystSni = document.getElementById("ib-hysteria-sni").value || "";
        
        streamSettings = {
            hysteria: {
                obfsPassword: obfsPassword,
                upMbps: upMbps,
                downMbps: downMbps,
                ignoreClientBandwidth: ignoreClientBandwidth,
                certMode: certMode,
                certPath: certPath,
                keyPath: keyPath,
                masqType: masqType,
                masqValue: masqValue,
                hop: hop,
                sni: hystSni,
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
        document.getElementById("ib-hysteria-sni").value = ho.sni || "";
        document.getElementById("ib-hysteria-routing-xray").checked = ho.routingViaXray || false;
        document.getElementById("ib-hysteria-ignore-bw").checked = ho.ignoreClientBandwidth || false;
    }
    
    if (settings.clients) {
        originalClients = settings.clients;
    }
    
    updateFormToggles();
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
            if (target.protocol === "vless") {
                document.getElementById("ib-vless-decryption").value = settings.decryption || "none";
                document.getElementById("ib-vless-encryption").value = settings.encryption || "none";
            }
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
        document.getElementById("ib-hysteria-sni").value = ho.sni || "";
        document.getElementById("ib-hysteria-routing-xray").checked = ho.routingViaXray || false;
        document.getElementById("ib-hysteria-ignore-bw").checked = ho.ignoreClientBandwidth || false;
    }
    
    updateFormToggles();
    switchInboundModalTab("basic");
    document.getElementById("inbound-modal").classList.add("active");
}

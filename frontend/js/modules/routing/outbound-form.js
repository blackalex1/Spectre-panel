import { apiFetch } from "../../api.js";
import { showToast } from "../../ui.js";
import { t } from "../../i18n.js";
import { parseProxyLink } from "./link-parser.js";
import { loadOutbounds, openOutboundModal } from "../routing-outbounds.js";

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
    const wireguardFields = document.getElementById("ob-wireguard-fields");
    
    if (wireguardFields) {
        wireguardFields.style.display = (protocol === "wireguard") ? "block" : "none";
    }
    
    if (encryptionGroup) {
        encryptionGroup.style.display = (protocol === "vless") ? "block" : "none";
    }
    
    // Label for password field
    const passLabel = document.querySelector("label[for='ob-password']");
    if (passLabel) {
        if (protocol === "vless") {
            passLabel.innerText = "UUID";
        } else if (protocol === "hysteria") {
            passLabel.innerText = t("validation_outbound_password_auth_label", "Пароль (Auth)");
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
            
            const insecureGroup = document.getElementById("ob-insecure-group");
            const pinnedGroup = document.getElementById("ob-pinned-sha256-group");
            if (insecureGroup) {
                insecureGroup.style.display = (security === "tls") ? "block" : "none";
            }
            if (pinnedGroup) {
                pinnedGroup.style.display = (security === "tls") ? "block" : "none";
            }
        } else if (protocol === "hysteria") {
            ssMethodGroup.style.display = "none";
            usernameField.style.display = "none";
            
            securityFields.style.display = "block";
            securityGroup.style.display = "none"; // Hysteria always uses TLS
            realityFields.style.display = "none";
            alpnGroup.style.display = "block";
            flowGroup.style.display = "none";
            
            hysteriaFields.style.display = "block";
            
            const insecureGroup = document.getElementById("ob-insecure-group");
            if (insecureGroup) {
                insecureGroup.style.display = "block";
            }
            const pinnedGroup = document.getElementById("ob-pinned-sha256-group");
            if (pinnedGroup) {
                pinnedGroup.style.display = "block";
            }

            const obfsVal = document.getElementById("ob-hysteria-obfs").value;
            const obfsPwdGroup = document.getElementById("ob-hysteria-obfs-password-group");
            if (obfsPwdGroup) {
                obfsPwdGroup.style.display = (obfsVal === "salamander") ? "block" : "none";
            }
        } else {
            // SOCKS, HTTP
            ssMethodGroup.style.display = "none";
            usernameField.style.display = "block";
            
            securityFields.style.display = "none";
            hysteriaFields.style.display = "none";
            if (usernameField) usernameField.style.display = "block";
            
            const insecureGroup = document.getElementById("ob-insecure-group");
            if (insecureGroup) insecureGroup.style.display = "none";
            const pinnedGroup = document.getElementById("ob-pinned-sha256-group");
            if (pinnedGroup) pinnedGroup.style.display = "none";
        }
    } else {
        proxyFields.style.display = "none";
        securityFields.style.display = "none";
        hysteriaFields.style.display = "none";
        const insecureGroup = document.getElementById("ob-insecure-group");
        if (insecureGroup) insecureGroup.style.display = "none";
        const pinnedGroup = document.getElementById("ob-pinned-sha256-group");
        if (pinnedGroup) pinnedGroup.style.display = "none";
    }
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
    } else if (protocol === "wireguard") {
        const privKey = document.getElementById("ob-wg-private-key");
        if (privKey && (!privKey.value || !privKey.value.trim())) {
            privKey.classList.add("input-invalid");
            errors.push(t("validation_outbound_wg_privkey_required", "Приватный ключ WireGuard обязателен"));
            isValid = false;
        }
        const addresses = document.getElementById("ob-wg-addresses");
        if (addresses && (!addresses.value || !addresses.value.trim())) {
            addresses.classList.add("input-invalid");
            errors.push(t("validation_outbound_wg_addresses_required", "Адреса интерфейса WireGuard обязательны"));
            isValid = false;
        }
        const peerPub = document.getElementById("ob-wg-peer-public-key");
        if (peerPub && (!peerPub.value || !peerPub.value.trim())) {
            peerPub.classList.add("input-invalid");
            errors.push(t("validation_outbound_wg_peer_pubkey_required", "Публичный ключ пира WireGuard обязателен"));
            isValid = false;
        }
        const endpoint = document.getElementById("ob-wg-endpoint");
        if (endpoint && (!endpoint.value || !endpoint.value.trim())) {
            endpoint.classList.add("input-invalid");
            errors.push(t("validation_outbound_wg_endpoint_required", "Эндпоинт пира WireGuard обязателен"));
            isValid = false;
        }
    }
    
    if (!isValid && errors.length > 0) {
        showToast(errors[0], "error");
    }
    return isValid;
}

export function setupOutboundFormListeners() {
    const addObBtn = document.getElementById("add-outbound-btn");
    if (addObBtn) {
        addObBtn.addEventListener("click", () => openOutboundModal());
    }
    
    const protocolSelect = document.getElementById("ob-protocol");
    if (protocolSelect) {
        protocolSelect.addEventListener("change", updateOutboundFormFields);
    }
    
    const securitySelect = document.getElementById("ob-security");
    if (securitySelect) {
        securitySelect.addEventListener("change", updateOutboundFormFields);
    }
    
    const obfsSelect = document.getElementById("ob-hysteria-obfs");
    if (obfsSelect) {
        obfsSelect.addEventListener("change", updateOutboundFormFields);
    }
    
    const importLinkInput = document.getElementById("ob-import-link");
    if (importLinkInput) {
        importLinkInput.addEventListener("input", (e) => {
            const val = e.target.value.trim();
            if (!val) return;
            
            const lowerVal = val.toLowerCase();
            if (lowerVal.startsWith("vless://") || 
                lowerVal.startsWith("ss://") || 
                lowerVal.startsWith("socks://") || 
                lowerVal.startsWith("socks5://") || 
                lowerVal.startsWith("http://") || 
                lowerVal.startsWith("hysteria2://") || 
                lowerVal.startsWith("hy2://") || 
                lowerVal.startsWith("hysteria://")) {
                
                const parsed = parseProxyLink(val);
                if (parsed) {
                    document.getElementById("ob-protocol").value = parsed.protocol;
                    document.getElementById("ob-remark").value = parsed.remark || "";
                    
                    const sanitizedHost = (parsed.host || "").replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
                    document.getElementById("ob-tag").value = `${parsed.protocol}-${sanitizedHost || Math.floor(Math.random() * 1000)}`;
                    
                    document.getElementById("ob-address").value = parsed.host || "";
                    document.getElementById("ob-port").value = parsed.port || "";
                    
                    document.getElementById("ob-username").value = "";
                    document.getElementById("ob-password").value = "";
                    
                    if (parsed.protocol === "vless") {
                        document.getElementById("ob-password").value = parsed.uuid || "";
                        document.getElementById("ob-security").value = parsed.security || "none";
                        document.getElementById("ob-sni").value = parsed.sni || "";
                        document.getElementById("ob-pbk").value = parsed.pbk || "";
                        document.getElementById("ob-shortid").value = parsed.sid || "";
                        document.getElementById("ob-fingerprint").value = parsed.fp || "chrome";
                        document.getElementById("ob-alpn").value = parsed.alpn || "";
                        document.getElementById("ob-flow").value = parsed.flow || "";
                        document.getElementById("ob-encryption").value = parsed.encryption || "";
                        document.getElementById("ob-pinned-sha256").value = parsed.pinSHA256 || "";
                    } else if (parsed.protocol === "hysteria") {
                        document.getElementById("ob-password").value = parsed.password || "";
                        document.getElementById("ob-sni").value = parsed.sni || "";
                        document.getElementById("ob-alpn").value = parsed.alpn || "";
                        document.getElementById("ob-up-mbps").value = parsed.up || "";
                        document.getElementById("ob-down-mbps").value = parsed.down || "";
                        document.getElementById("ob-allow-insecure").checked = parsed.insecure === true;
                        document.getElementById("ob-hysteria-obfs").value = parsed.obfs || "";
                        document.getElementById("ob-hysteria-obfs-password").value = parsed.obfsPassword || "";
                        document.getElementById("ob-pinned-sha256").value = parsed.pinSHA256 || "";
                    } else if (parsed.protocol === "shadowsocks") {
                        document.getElementById("ob-password").value = parsed.password || "";
                        document.getElementById("ob-ss-method").value = parsed.method || "aes-256-gcm";
                    } else if (parsed.protocol === "socks" || parsed.protocol === "http") {
                        document.getElementById("ob-username").value = parsed.username || "";
                        document.getElementById("ob-password").value = parsed.password || "";
                    }
                    
                    e.target.value = ""; 
                    updateOutboundFormFields();
                    
                    const inputs = document.querySelectorAll("#outbound-form input, #outbound-form select, #outbound-form textarea");
                    inputs.forEach(el => el.classList.remove("input-invalid"));
                    
                    showToast(t("routing_modal_import_success", "Ссылка успешно импортирована!"));
                } else {
                    showToast(t("routing_modal_import_error", "Не удалось распознать ссылку. Проверьте формат."), "warning");
                }
            }
        });
    }

    const testObBtn = document.getElementById("ob-test-btn");
    if (testObBtn) {
        testObBtn.addEventListener("click", async () => {
            if (!validateOutboundForm()) return;
            
            const icon = testObBtn.querySelector("i");
            const btnText = testObBtn.querySelector("span");
            const originalClass = icon.className;
            const originalText = btnText.innerText;
            
            icon.className = "fa-solid fa-spinner fa-spin";
            btnText.innerText = t("routing_testing", "Проверка...");
            testObBtn.disabled = true;
            
            try {
                const protocol = document.getElementById("ob-protocol").value;
                const test_type = document.getElementById("ob-test-type").value;
                const address = document.getElementById("ob-address").value.trim();
                const port = parseInt(document.getElementById("ob-port").value);
                const password = document.getElementById("ob-password").value.trim();
                
                let settings = {};
                let streamSettings = {};
                
                if (protocol === "shadowsocks") {
                    const method = document.getElementById("ob-ss-method").value;
                    settings = {
                        "servers": [{ "address": address, "port": port, "password": password, "method": method }]
                    };
                } else if (protocol === "vless") {
                    const flow = document.getElementById("ob-flow").value;
                    const encryption = document.getElementById("ob-encryption").value.trim() || "none";
                    settings = {
                        "vnext": [{
                            "address": address,
                            "port": port,
                            "users": [{ "id": password, "encryption": encryption, "flow": flow }]
                        }]
                    };
                    
                    const security = document.getElementById("ob-security").value;
                    const sni = document.getElementById("ob-sni").value.trim();
                    streamSettings = {
                        "network": "tcp",
                        "security": security
                    };
                    
                    if (security === "tls") {
                        const alpnInput = document.getElementById("ob-alpn").value.trim();
                        const alpn = alpnInput ? alpnInput.split(",").map(s => s.trim()).filter(Boolean) : [];
                        const allowInsecure = document.getElementById("ob-allow-insecure").checked;
                        streamSettings.tlsSettings = {
                            "serverName": sni,
                            "allowInsecure": allowInsecure
                        };
                        const pinnedShaInput = document.getElementById("ob-pinned-sha256").value.trim();
                        if (pinnedShaInput) {
                            const pins = pinnedShaInput.split(/[,~]+/)
                                .map(s => s.replace(/:/g, "").trim().toLowerCase())
                                .filter(Boolean);
                            if (pins.length > 0) {
                                streamSettings.tlsSettings.pinnedPeerCertSha256 = pins.join("~");
                            }
                        }
                        if (alpn.length > 0) {
                            streamSettings.tlsSettings.alpn = alpn;
                        }
                    } else if (security === "reality") {
                        const pbk = document.getElementById("ob-pbk").value.trim();
                        const shortId = document.getElementById("ob-shortid").value.trim();
                        const fp = document.getElementById("ob-fingerprint").value;
                        streamSettings.realitySettings = {
                            "serverName": sni,
                            "publicKey": pbk,
                            "shortId": shortId,
                            "fingerprint": fp
                        };
                    }
                } else if (protocol === "hysteria") {
                    settings = { "version": 2, "address": address, "port": port };
                    
                    const sni = document.getElementById("ob-sni").value.trim();
                    const alpnInput = document.getElementById("ob-alpn").value.trim() || "h3";
                    const alpn = alpnInput.split(",").map(s => s.trim()).filter(Boolean);
                    const allowInsecure = document.getElementById("ob-allow-insecure").checked;
                    
                    const upMbps = parseInt(document.getElementById("ob-up-mbps").value);
                    const downMbps = parseInt(document.getElementById("ob-down-mbps").value);
                    
                    let hysteriaSettings = { "version": 2, "auth": password };
                    if (!isNaN(upMbps) && upMbps > 0) hysteriaSettings.up = `${upMbps} mbps`;
                    if (!isNaN(downMbps) && downMbps > 0) hysteriaSettings.down = `${downMbps} mbps`;
                    
                    const obfsType = document.getElementById("ob-hysteria-obfs").value;
                    if (obfsType) {
                        hysteriaSettings.obfs = obfsType;
                        hysteriaSettings.obfs_type = obfsType;
                        const obfsPwd = document.getElementById("ob-hysteria-obfs-password").value.trim();
                        if (obfsPwd) {
                            hysteriaSettings.obfsPassword = obfsPwd;
                            hysteriaSettings.obfs_password = obfsPwd;
                        }
                    }
                    
                    const pinnedShaInput = document.getElementById("ob-pinned-sha256").value.trim();
                    let tlsSettings = {
                        "serverName": sni,
                        "alpn": alpn,
                        "allowInsecure": allowInsecure
                    };
                    if (pinnedShaInput) {
                        const pins = pinnedShaInput.split(/[,~]+/)
                            .map(s => s.replace(/:/g, "").trim().toLowerCase())
                            .filter(Boolean);
                        if (pins.length > 0) {
                            tlsSettings.pinnedPeerCertSha256 = pins.join("~");
                        }
                    }
                    
                    streamSettings = {
                        "network": "hysteria",
                        "security": "tls",
                        "tlsSettings": tlsSettings,
                        "hysteriaSettings": hysteriaSettings
                    };
                } else if (protocol === "socks" || protocol === "http") {
                    const username = document.getElementById("ob-username").value.trim();
                    const users = username || password ? [{"user": username, "pass": password}] : [];
                    settings = {
                        "servers": [{ "address": address, "port": port, "users": users }]
                    };
                }
                
                const res = await apiFetch("/api/routing/outbounds/test", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ protocol, settings, streamSettings, test_type })
                });
                
                if (res && res.success) {
                    showToast(t("routing_test_success", "Соединение успешно!") + ` (${res.ping} ms)`);
                } else {
                    showToast(res ? res.msg : t("routing_toast_connection_error", "Ошибка соединения"), "error");
                }
            } catch (err) {
                showToast("Error: " + err.message, "error");
            } finally {
                icon.className = originalClass;
                btnText.innerText = originalText;
                testObBtn.disabled = false;
            }
        });
    }
    
    const outboundForm = document.getElementById("outbound-form");
    if (outboundForm) {
        outboundForm.querySelectorAll("input, select, textarea").forEach(el => {
            el.addEventListener("input", () => {
                el.classList.remove("input-invalid");
            });
            el.addEventListener("change", () => {
                el.classList.remove("input-invalid");
            });
        });

        outboundForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            
            if (!validateOutboundForm()) {
                return;
            }
            
            const id = document.getElementById("ob-id").value;
            const remark = document.getElementById("ob-remark").value.trim();
            const protocol = document.getElementById("ob-protocol").value;
            const tag = document.getElementById("ob-tag").value.trim();
            const enable = document.getElementById("ob-enable").checked ? 1 : 0;
            
            // Prepare settings JSON
            let settings = {};
            let streamSettings = {};
            
            if (protocol === "wireguard") {
                const privateKey = document.getElementById("ob-wg-private-key").value.trim();
                const addressesInput = document.getElementById("ob-wg-addresses").value.trim();
                const addressList = addressesInput ? addressesInput.split(",").map(s => s.trim()).filter(Boolean) : [];
                
                const reservedInput = document.getElementById("ob-wg-reserved").value.trim();
                let reserved = [];
                if (reservedInput) {
                    reserved = reservedInput.split(",").map(s => parseInt(s.trim())).filter(x => !isNaN(x));
                }
                
                const peerPublicKey = document.getElementById("ob-wg-peer-public-key").value.trim();
                const peerEndpoint = document.getElementById("ob-wg-endpoint").value.trim();
                
                const mtuInput = document.getElementById("ob-wg-mtu").value.trim();
                const mtu = mtuInput ? parseInt(mtuInput) : null;
                
                settings = {
                    "secretKey": privateKey,
                    "address": addressList,
                    "peers": [{
                        "publicKey": peerPublicKey,
                        "endpoint": peerEndpoint
                    }]
                };
                
                if (reserved.length > 0) {
                    settings.reserved = reserved;
                }
                if (mtu) {
                    settings.mtu = mtu;
                }
            } else if (protocol === "socks" || protocol === "http" || protocol === "shadowsocks" || protocol === "vless" || protocol === "hysteria") {
                const address = document.getElementById("ob-address").value.trim();
                const port = parseInt(document.getElementById("ob-port").value);
                const password = document.getElementById("ob-password").value.trim();
                
                if (!address || isNaN(port)) {
                    showToast(t("routing_err_host_port", "Укажите адрес и порт сервера прокси"), "warning");
                    return;
                }
                
                if (protocol === "shadowsocks") {
                    const method = document.getElementById("ob-ss-method").value;
                    settings = {
                        "servers": [{
                            "address": address,
                            "port": port,
                            "password": password,
                            "method": method
                        }]
                    };
                } else if (protocol === "vless") {
                    const flow = document.getElementById("ob-flow").value;
                    const encryption = document.getElementById("ob-encryption").value.trim() || "none";
                    settings = {
                        "vnext": [{
                            "address": address,
                            "port": port,
                            "users": [{
                                "id": password,
                                "encryption": encryption,
                                "flow": flow
                            }]
                        }]
                    };
                    
                    const security = document.getElementById("ob-security").value;
                    const sni = document.getElementById("ob-sni").value.trim();
                    streamSettings = {
                        "network": "tcp",
                        "security": security
                    };
                    
                    if (security === "tls") {
                        const alpnInput = document.getElementById("ob-alpn").value.trim();
                        const alpn = alpnInput ? alpnInput.split(",").map(s => s.trim()).filter(Boolean) : [];
                        const allowInsecure = document.getElementById("ob-allow-insecure").checked;
                        streamSettings.tlsSettings = {
                            "serverName": sni,
                            "allowInsecure": allowInsecure
                        };
                        const pinnedShaInput = document.getElementById("ob-pinned-sha256").value.trim();
                        if (pinnedShaInput) {
                            const pins = pinnedShaInput.split(/[,~]+/)
                                .map(s => s.trim())
                                .filter(Boolean);
                            if (pins.length > 0) {
                                streamSettings.tlsSettings.pinnedPeerCertSha256 = pins.join("~");
                            }
                        }
                        if (alpn.length > 0) {
                            streamSettings.tlsSettings.alpn = alpn;
                        }
                    } else if (security === "reality") {
                        const pbk = document.getElementById("ob-pbk").value.trim();
                        const shortId = document.getElementById("ob-shortid").value.trim();
                        const fp = document.getElementById("ob-fingerprint").value;
                        streamSettings.realitySettings = {
                            "serverName": sni,
                            "publicKey": pbk,
                            "shortId": shortId,
                            "fingerprint": fp
                        };
                    }
                } else if (protocol === "hysteria") {
                    settings = {
                        "version": 2,
                        "address": address,
                        "port": port
                    };
                    
                    const sni = document.getElementById("ob-sni").value.trim();
                    const alpnInput = document.getElementById("ob-alpn").value.trim() || "h3";
                    const alpn = alpnInput.split(",").map(s => s.trim()).filter(Boolean);
                    const allowInsecure = document.getElementById("ob-allow-insecure").checked;
                    
                    const upMbps = parseInt(document.getElementById("ob-up-mbps").value);
                    const downMbps = parseInt(document.getElementById("ob-down-mbps").value);
                    
                    let hysteriaSettings = {
                        "version": 2,
                        "auth": password
                    };
                    if (!isNaN(upMbps) && upMbps > 0) {
                        hysteriaSettings.up = `${upMbps} mbps`;
                    }
                    if (!isNaN(downMbps) && downMbps > 0) {
                        hysteriaSettings.down = `${downMbps} mbps`;
                    }
                    
                    const obfsType = document.getElementById("ob-hysteria-obfs").value;
                    if (obfsType) {
                        hysteriaSettings.obfs = obfsType;
                        hysteriaSettings.obfs_type = obfsType;
                        const obfsPwd = document.getElementById("ob-hysteria-obfs-password").value.trim();
                        if (obfsPwd) {
                            hysteriaSettings.obfsPassword = obfsPwd;
                            hysteriaSettings.obfs_password = obfsPwd;
                        }
                    }
                    
                    const pinnedShaInput = document.getElementById("ob-pinned-sha256").value.trim();
                    let tlsSettings = {
                        "serverName": sni,
                        "alpn": alpn,
                        "allowInsecure": allowInsecure
                    };
                    if (pinnedShaInput) {
                        const pins = pinnedShaInput.split(/[,~]+/)
                            .map(s => s.trim())
                            .filter(Boolean);
                        if (pins.length > 0) {
                            tlsSettings.pinnedPeerCertSha256 = pins.join("~");
                        }
                    }
                    
                    streamSettings = {
                        "network": "hysteria",
                        "security": "tls",
                        "tlsSettings": tlsSettings,
                        "hysteriaSettings": hysteriaSettings
                    };
                } else {
                    const username = document.getElementById("ob-username").value.trim();
                    const users = username || password ? [{"user": username, "pass": password}] : [];
                    settings = {
                        "servers": [{
                            "address": address,
                            "port": port,
                            "users": users
                        }]
                    };
                }
            }
            
            const url = id ? `/api/routing/outbounds/update/${id}` : "/api/routing/outbounds/create";
            const res = await apiFetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ remark, protocol, tag, settings, streamSettings, enable })
            });
            
            if (res && res.success) {
                showToast(id ? t("routing_outbound_updated", "Исходящее подключение обновлено") : t("routing_outbound_created", "Исходящее подключение создано"));
                document.getElementById("outbound-modal").classList.remove("active");
                loadOutbounds();
            } else {
                showToast(res ? res.msg : "Error", "error");
            }
        });
    }
}

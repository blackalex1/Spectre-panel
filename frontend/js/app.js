import { getCsrfToken, setCsrfToken, apiFetch } from "./api.js";
import { showToast, loadComponent } from "./ui.js";
import { initI18n, t } from "./i18n.js";

const tg = window.Telegram ? window.Telegram.WebApp : null;
if (tg) {
    tg.ready();
    tg.expand();
}

document.addEventListener("DOMContentLoaded", async () => {
    await initI18n();
    setupLoginListener();
    await initApp();
});

async function initApp() {
    document.getElementById("loading-overlay").classList.add("active");
    
    // 1. Telegram WebApp Authorization
    if (tg && tg.initData) {
        document.getElementById("loading-text").innerText = "Авторизация в Telegram...";
        const res = await apiFetch("/api/auth/telegram", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ initData: tg.initData })
        });
        
        if (res && res.success) {
            setCsrfToken(res.token);
            showToast(t("tg_auth_success", "Авторизация Telegram успешна!"));
            await startPanel();
        } else {
            document.getElementById("loading-overlay").classList.remove("active");
            showToast(res ? res.msg : t("tg_auth_error", "Ошибка проверки подписи"), "error");
            document.getElementById("login-overlay").classList.add("active");
        }
        return;
    }
    
    // 2. Regular Browser Cookie Session Authorization
    const csrfRes = await apiFetch("/csrf-token");
    if (csrfRes && csrfRes.success) {
        setCsrfToken(csrfRes.obj);
        await startPanel();
    } else {
        document.getElementById("loading-overlay").classList.remove("active");
        document.getElementById("login-overlay").classList.add("active");
    }
}

async function loadAuthorizedComponents() {
    const loadingOverlay = document.getElementById("loading-overlay");
    const loadingText = document.getElementById("loading-text");
    if (loadingOverlay) loadingOverlay.classList.add("active");
    if (loadingText) loadingText.innerText = t("loading_components", "Загрузка компонентов...");
    
    // Загружаем все компоненты интерфейса параллельно только после успешной авторизации
    await Promise.all([
        loadComponent("tab-dashboard", "components/dashboard.html", ".content-area"),
        loadComponent("tab-inbounds", "components/inbounds.html", ".content-area"),
        loadComponent("tab-xray", "components/xray.html", ".content-area"),
        loadComponent("tab-hysteria", "components/hysteria.html", ".content-area"),
        loadComponent("tab-routing", "components/routing.html", ".content-area"),
        loadComponent("tab-settings", "components/settings.html", ".content-area"),
        loadComponent("inbound-modal", "components/inbound-modal.html", "body"),
        loadComponent("clients-modal", "components/clients-modal.html", "body"),
        loadComponent("client-modal", "components/client-modal.html", "body"),
        loadComponent("links-modal", "components/links-modal.html", "body"),
        loadComponent("json-modal", "components/json-modal.html", "body")
    ]);
}

async function loadPanelStylesheets() {
    const sheets = [
        "css/pages/dashboard.css",
        "css/pages/inbounds.css",
        "css/pages/settings.css",
        "css/pages/routing.css"
    ];
    await Promise.all(sheets.map(href => {
        return new Promise((resolve) => {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = href;
            link.onload = resolve;
            link.onerror = resolve; // Продолжить даже при ошибке
            document.head.appendChild(link);
        });
    }));
}

async function startPanel() {
    await Promise.all([
        loadAuthorizedComponents(),
        loadPanelStylesheets()
    ]);
    
    // Динамический импорт всей административной логики
    const { initPanel } = await import("./panel-main.js");
    await initPanel();
    
    document.getElementById("loading-overlay").classList.remove("active");
    document.getElementById("login-overlay").classList.remove("active");
    document.getElementById("app-container").classList.add("active");
}

function setupLoginListener() {
    const loginForm = document.getElementById("login-form");
    const credentialsGroup = document.getElementById("login-credentials-group");
    const faGroup = document.getElementById("login-2fa-group");
    const btnBack = document.getElementById("btn-login-2fa-back");
    const totpInput = document.getElementById("login-totp-code");
    
    let is2faState = false;
    let cachedUsername = "";
    let cachedPassword = "";

    if (btnBack) {
        btnBack.addEventListener("click", () => {
            is2faState = false;
            if (credentialsGroup) credentialsGroup.style.display = "block";
            if (faGroup) faGroup.style.display = "none";
            if (btnBack) btnBack.style.display = "none";
            if (totpInput) totpInput.value = "";
            const errorDiv = document.getElementById("login-error");
            if (errorDiv) errorDiv.innerText = "";
        });
    }

    if (loginForm) {
        loginForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const errorDiv = document.getElementById("login-error");
            if (errorDiv) errorDiv.innerText = "";
            
            let payload = {};
            
            if (!is2faState) {
                const usernameInput = document.getElementById("username");
                const passwordInput = document.getElementById("password");
                const username = usernameInput ? usernameInput.value.trim() : "";
                const password = passwordInput ? passwordInput.value : "";
                
                if (!username || !password) {
                    if (errorDiv) errorDiv.innerText = t("login_empty_fields", "Введите логин и пароль");
                    return;
                }
                
                cachedUsername = username;
                cachedPassword = password;
                payload = { username, password };
            } else {
                const code = totpInput ? totpInput.value.trim() : "";
                if (!code || code.length !== 6 || isNaN(code)) {
                    if (errorDiv) errorDiv.innerText = t("login_empty_2fa_code", "Введите 6-значный код");
                    return;
                }
                payload = { username: cachedUsername, password: cachedPassword, code };
            }
            
            const res = await apiFetch("/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            
            if (res && res.success) {
                if (res.requires_2fa) {
                    is2faState = true;
                    if (credentialsGroup) credentialsGroup.style.display = "none";
                    if (faGroup) faGroup.style.display = "block";
                    if (btnBack) btnBack.style.display = "block";
                    if (totpInput) totpInput.focus();
                } else {
                    const csrfRes = await apiFetch("/csrf-token");
                    if (csrfRes && csrfRes.success) {
                        setCsrfToken(csrfRes.obj);
                    }
                    await startPanel();
                }
            } else {
                if (errorDiv) {
                    errorDiv.innerText = res ? res.msg : t("login_failed", "Не удалось авторизоваться");
                }
            }
        });
    }
}

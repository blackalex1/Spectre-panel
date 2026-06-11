// Shared UI Utility functions
import { translatePage } from "./i18n.js";

window.addEventListener("show-toast", (e) => {
    if (e.detail && e.detail.text) {
        showToast(e.detail.text, e.detail.type || "success");
    }
});

export function showToast(text, type = "success") {
    const container = document.getElementById("toast-container");
    if (!container) return;
    
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    
    let icon = "fa-circle-check";
    if (type === "error") icon = "fa-circle-xmark";
    else if (type === "info") icon = "fa-circle-info";
    
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${text}</span>`;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = "toastIn 0.3s reverse forwards";
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

export function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

const loadedComponents = new Set();

export async function loadComponent(id, filePath, targetSelector) {
    if (loadedComponents.has(id)) return true;
    
    try {
        const response = await fetch(filePath);
        if (!response.ok) throw new Error(`Failed to load component ${id}`);
        const html = await response.text();
        const target = document.querySelector(targetSelector);
        if (target) {
            target.insertAdjacentHTML('beforeend', html);
            loadedComponents.add(id);
            try {
                translatePage();
            } catch (e) {}
            return true;
        }
    } catch (err) {
        console.error(`Error loading component ${id}:`, err);
    }
    return false;
}

const API_BASE = location.hostname === "localhost"
    ? "http://localhost:3000"
    : "https://YOUR-RENDER-URL.onrender.com";

function getToken() {
    return localStorage.getItem("token");
}

async function apiFetch(url, options = {}) {

    const token = getToken();

    const headers = {
        ...(options.headers || {})
    };

    // only set Content-Type when NOT FormData
    if (!(options.body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
    }

    if (token) {
        headers["Authorization"] = "Bearer " + token;
    }

    const res = await fetch(API_BASE + url, {
        ...options,
        headers
    });

    const text = await res.text();

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}
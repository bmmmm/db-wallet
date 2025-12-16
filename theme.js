(() => {
    const THEME_KEY = "db-wallet:theme";
    const SELECTABLE_THEME_NAMES = [
        "Lilac Carbon",
        "Teal Ember",
        "Slate Sunrise",
        "Paper Mint",
        "Peach Cloud",
    ];

    const LEGACY_THEME_ALIASES = {
        "Nord Glow": "Lilac Carbon",
        "Cyan Mist": "Teal Ember",
    };

    function canonicalThemeName(name) {
        const raw = String(name || "").trim();
        return LEGACY_THEME_ALIASES[raw] || raw;
    }

    function isSelectableThemeName(name) {
        return SELECTABLE_THEME_NAMES.includes(name);
    }

    function getStoredTheme() {
        try {
            const stored = localStorage.getItem(THEME_KEY);
            const canonical = canonicalThemeName(stored);
            return isSelectableThemeName(canonical) ? canonical : null;
        } catch (e) {
            return null;
        }
    }

    function highlightActiveTheme(name) {
        const buttons = document.querySelectorAll(".theme-btn");
        buttons.forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.theme === name);
        });
    }

    function applyTheme(name) {
        const canonical = canonicalThemeName(name);
        if (!isSelectableThemeName(canonical)) return false;
        document.documentElement.setAttribute("data-theme", canonical);
        try {
            localStorage.setItem(THEME_KEY, canonical);
        } catch (e) {
            // ignore storage issues
        }
        highlightActiveTheme(canonical);
        return true;
    }

    function initThemeSelector(options = {}) {
        const container =
            options.container ||
            document.getElementById(options.containerId || "theme-buttons");
        if (!container) return;

        container.innerHTML = "";
        const names = Array.isArray(options.names)
            ? options.names
            : SELECTABLE_THEME_NAMES;

        names.forEach((themeName) => {
            const btn = document.createElement("button");
            btn.className = "theme-btn";
            btn.dataset.theme = themeName;
            btn.textContent = themeName;
            btn.addEventListener("click", () => applyTheme(themeName));
            container.appendChild(btn);
        });

        const stored = getStoredTheme();
        if (stored) {
            applyTheme(stored);
        }
    }

    window.dbWalletTheme = {
        THEME_KEY,
        SELECTABLE_THEME_NAMES,
        canonicalThemeName,
        isSelectableThemeName,
        getStoredTheme,
        applyTheme,
        highlightActiveTheme,
        initThemeSelector,
    };

    const stored = getStoredTheme();
    if (stored) {
        applyTheme(stored);
    }
})();

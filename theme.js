(() => {
    const THEME_KEY = "db-wallet:theme";
    const SELECTABLE_THEME_NAMES = [
        "Lilac Carbon",
        "Teal Ember",
        "Slate Sunrise",
        "Paper Mint",
        "Peach Cloud",
    ];

    // Background (= browser UI colour, <meta name="theme-color">) per theme.
    // Must match --bg in themes.css (tests/p3-1-theme.test.js checks it).
    const THEME_BG = {
        "Lilac Carbon": "#121322",
        "Teal Ember": "#10201f",
        "Slate Sunrise": "#141b24",
        "Paper Mint": "#f2f7f5",
        "Peach Cloud": "#faf3ee",
    };
    const DEFAULT_DARK_THEME = "Lilac Carbon";
    const DEFAULT_LIGHT_THEME = "Paper Mint";

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

    function prefersLight() {
        try {
            return (
                typeof window.matchMedia === "function" &&
                window.matchMedia("(prefers-color-scheme: light)").matches
            );
        } catch (e) {
            return false;
        }
    }

    // Without a stored choice: follow the OS (dark → Lilac Carbon, light →
    // Paper Mint). Not persisted, so it keeps following the OS.
    function getDefaultTheme() {
        return prefersLight() ? DEFAULT_LIGHT_THEME : DEFAULT_DARK_THEME;
    }

    function getCurrentTheme() {
        return getStoredTheme() || getDefaultTheme();
    }

    function setThemeColorMeta(name) {
        const color = THEME_BG[name];
        if (!color) return;
        try {
            const meta = document.querySelector('meta[name="theme-color"]');
            if (meta) meta.setAttribute("content", color);
        } catch (e) {
            // ignore — cosmetic only
        }
    }

    function highlightActiveTheme(name) {
        const buttons = document.querySelectorAll(".theme-btn");
        buttons.forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.theme === name);
        });
    }

    // opts.persist === false: show the theme without storing it (the OS
    // default). Every explicit choice (button, import) persists.
    function applyTheme(name, opts) {
        const canonical = canonicalThemeName(name);
        if (!isSelectableThemeName(canonical)) return false;
        document.documentElement.setAttribute("data-theme", canonical);
        setThemeColorMeta(canonical);
        if (!opts || opts.persist !== false) {
            try {
                localStorage.setItem(THEME_KEY, canonical);
            } catch (e) {
                // ignore storage issues
            }
        }
        highlightActiveTheme(canonical);
        return true;
    }

    function applyCurrentTheme() {
        const stored = getStoredTheme();
        return applyTheme(stored || getDefaultTheme(), { persist: !!stored });
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

        applyCurrentTheme();
    }

    window.dbWalletTheme = {
        THEME_KEY,
        SELECTABLE_THEME_NAMES,
        THEME_BG,
        canonicalThemeName,
        isSelectableThemeName,
        getStoredTheme,
        getDefaultTheme,
        getCurrentTheme,
        applyTheme,
        highlightActiveTheme,
        initThemeSelector,
    };

    applyCurrentTheme();

    // Follow an OS light/dark switch while no theme is stored.
    try {
        if (typeof window.matchMedia === "function") {
            const mq = window.matchMedia("(prefers-color-scheme: light)");
            const onChange = () => {
                if (!getStoredTheme()) applyCurrentTheme();
            };
            if (mq && typeof mq.addEventListener === "function") {
                mq.addEventListener("change", onChange);
            }
        }
    } catch (e) {
        // ignore
    }
})();

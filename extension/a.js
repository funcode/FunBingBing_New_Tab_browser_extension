(() => {
    const FONT_STORAGE_KEY = 'funbing_quote_font_selection';
    const SAMPLE_TEXT = '落霞与孤鹜齐飞 1234567890';

    const BASE_FONTS = [
        {
            label: 'Pretendard Variable',
            stack: '"Pretendard Variable", "Pretendard", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            primary: 'Pretendard Variable',
            keywords: 'sans-serif modern korean',
            origin: '常用字体'
        },
        {
            label: 'Noto Sans SC / 思源黑体',
            stack: '"Noto Sans SC", "思源黑体", "Microsoft YaHei", "Helvetica Neue", sans-serif',
            primary: 'Noto Sans SC',
            keywords: 'sans-serif chinese',
            origin: '常用字体'
        },
        {
            label: 'Source Han Serif / 思源宋体',
            stack: '"Source Han Serif", "思源宋体", "Songti SC", "SimSun", serif',
            primary: 'Source Han Serif',
            keywords: 'serif chinese',
            origin: '常用字体'
        },
        {
            label: 'FangSong 仿宋',
            stack: '"FangSong", "STFangsong", "STSong", "SimSun", serif',
            primary: 'FangSong',
            keywords: 'serif chinese classic',
            origin: '常用字体'
        },
        {
            label: 'KaiTi 楷体',
            stack: '"KaiTi", "Kaiti SC", "STKaiti", "KaiTi_GB2312", serif',
            primary: 'KaiTi',
            keywords: 'serif chinese handwriting',
            origin: '常用字体'
        },
        {
            label: 'Arial',
            stack: '"Arial", "Helvetica Neue", Helvetica, sans-serif',
            primary: 'Arial',
            keywords: 'sans-serif latin web-safe',
            origin: 'Web 安全字体'
        },
        {
            label: 'Helvetica Neue',
            stack: '"Helvetica Neue", Helvetica, "Arial", sans-serif',
            primary: 'Helvetica Neue',
            keywords: 'sans-serif latin modern',
            origin: 'Web 安全字体'
        },
        {
            label: 'Segoe UI',
            stack: '"Segoe UI", "Helvetica Neue", "Arial", sans-serif',
            primary: 'Segoe UI',
            keywords: 'sans-serif ui windows',
            origin: 'Web 安全字体'
        },
        {
            label: 'SF Pro Text',
            stack: '"SF Pro Text", "SF Pro Display", "Helvetica Neue", sans-serif',
            primary: 'SF Pro Text',
            keywords: 'sans-serif apple ui',
            origin: '系统字体'
        },
        {
            label: 'Times New Roman',
            stack: '"Times New Roman", Times, "Songti SC", serif',
            primary: 'Times New Roman',
            keywords: 'serif latin classic',
            origin: 'Web 安全字体'
        },
        {
            label: 'Georgia',
            stack: 'Georgia, "Times New Roman", serif',
            primary: 'Georgia',
            keywords: 'serif latin web-safe',
            origin: 'Web 安全字体'
        },
        {
            label: 'Courier New',
            stack: '"Courier New", Courier, monospace',
            primary: 'Courier New',
            keywords: 'monospace typewriter',
            origin: 'Web 安全字体'
        },
        {
            label: 'JetBrains Mono',
            stack: '"JetBrains Mono", "Fira Code", "Source Code Pro", monospace',
            primary: 'JetBrains Mono',
            keywords: 'monospace developer',
            origin: '常用字体'
        }
    ];

    const state = {
        fonts: [],
        filteredFonts: [],
        selectedStack: '',
        selectedLabel: '默认',
        defaultFamily: ''
    };

    const els = {
        list: null,
        search: null,
        currentName: null,
        quoteBox: null
    };

    const safeLocaleCompare = (a, b) => a.localeCompare(b, 'zh-Hans-CN', { sensitivity: 'base' });

    const checkFontAvailability = (fontName) => {
        if (!fontName) return true;
        if (document.fonts && typeof document.fonts.check === 'function') {
            try {
                return document.fonts.check(`16px "${fontName}"`);
            } catch (error) {
                return true;
            }
        }
        return true;
    };

    const getPrimaryFromStack = (stack) => {
        if (!stack) return '';
        const [first] = stack.split(',');
        return first ? first.replace(/['\"]/g, '').trim() : '';
    };

    const buildFontCatalogue = async () => {
        const catalogue = new Map();
        BASE_FONTS.forEach((font) => {
            const primary = font.primary || getPrimaryFromStack(font.stack);
            const available = checkFontAvailability(primary);
            catalogue.set(font.label, { ...font, available, primary });
        });

        if (document.fonts && typeof document.fonts.forEach === 'function') {
            try {
                await document.fonts.ready;
                document.fonts.forEach((fontFace) => {
                    const family = fontFace.family.replace(/['\"]/g, '').trim();
                    if (!family) return;
                    if (!catalogue.has(family)) {
                        catalogue.set(family, {
                            label: family,
                            stack: `"${family}"`,
                            primary: family,
                            keywords: 'document font',
                            origin: '页面字体',
                            available: true
                        });
                    }
                });
            } catch (error) {
                console.warn('[Font Picker] document.fonts.ready failed:', error);
            }
        }

        return Array.from(catalogue.values()).sort((a, b) => safeLocaleCompare(a.label, b.label));
    };

    const getStoredSelection = () => {
        try {
            const raw = localStorage.getItem(FONT_STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.stack === 'string' && typeof parsed.label === 'string') {
                return parsed;
            }
        } catch (error) {
            console.warn('[Font Picker] Failed to read stored selection', error);
        }
        return null;
    };

    const storeSelection = (value) => {
        try {
            localStorage.setItem(FONT_STORAGE_KEY, JSON.stringify(value));
        } catch (error) {
            console.warn('[Font Picker] Failed to persist selection', error);
        }
    };

    const updateCurrentDisplay = () => {
        if (!els.currentName) return;
        const displayFont = state.selectedStack || state.defaultFamily;
        const displayLabel = state.selectedStack ? state.selectedLabel : `默认 (${state.defaultFamily})`;
        els.currentName.textContent = displayLabel;
        els.currentName.style.fontFamily = displayFont;
    };

    const highlightSelection = () => {
        if (!els.list) return;
        const buttons = els.list.querySelectorAll('.font-picker__option');
        buttons.forEach((button) => {
            button.classList.toggle('is-active', button.dataset.fontStack === state.selectedStack);
        });
    };

    const applyFont = (stack, label, { persist = true } = {}) => {
        state.selectedStack = stack || '';
        state.selectedLabel = label || '默认';
        if (els.quoteBox) {
            els.quoteBox.style.fontFamily = state.selectedStack || '';
        }
        updateCurrentDisplay();
        highlightSelection();
        if (persist) {
            storeSelection({ stack: state.selectedStack, label: state.selectedLabel });
        }
    };

    const renderList = (fonts, searchTerm = '') => {
        if (!els.list) return;
        const term = searchTerm.trim().toLowerCase();
        const filtered = term
            ? fonts.filter((font) => {
                const haystack = `${font.label} ${font.stack} ${font.keywords || ''}`.toLowerCase();
                return haystack.includes(term);
            })
            : fonts;

        els.list.innerHTML = '';

        if (!filtered.length) {
            const empty = document.createElement('div');
            empty.className = 'font-picker__empty';
            empty.textContent = '未找到匹配的字体，请尝试其他关键字。';
            els.list.appendChild(empty);
            return;
        }

        filtered.forEach((font) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'font-picker__option';
            button.dataset.fontStack = font.stack;
            button.dataset.fontLabel = font.label;
            button.setAttribute('role', 'option');
            button.setAttribute('aria-label', `${font.label}${font.origin ? `，来源：${font.origin}` : ''}`);
            if (!font.available) {
                button.dataset.available = 'false';
            }

            const name = document.createElement('span');
            name.className = 'font-picker__option-name';
            name.textContent = font.label;

            const meta = document.createElement('span');
            meta.className = 'font-picker__option-meta';
            meta.textContent = font.origin || '自定义';

            const preview = document.createElement('span');
            preview.className = 'font-picker__option-preview';
            preview.textContent = SAMPLE_TEXT;
            preview.style.fontFamily = font.stack;

            button.append(name, meta, preview);
            if (font.stack === state.selectedStack) {
                button.classList.add('is-active');
            }
            els.list.appendChild(button);
        });
    };

    const handleSelection = (event) => {
        const target = event.target instanceof HTMLElement
            ? event.target.closest('.font-picker__option')
            : null;
        if (!target || !(target instanceof HTMLElement)) return;

        const stack = target.dataset.fontStack || '';
        const label = target.dataset.fontLabel || '自定义';
        applyFont(stack, label);
    };

    const handleSearch = (event) => {
        const value = typeof event.target?.value === 'string' ? event.target.value : '';
        renderList(state.fonts, value);
    };

    const prepare = async () => {
        els.list = document.getElementById('font-picker-list');
        els.search = document.getElementById('font-search');
        els.currentName = document.getElementById('font-current-name');
        els.quoteBox = document.querySelector('.quote .app-dash');

        if (!els.list || !els.currentName || !els.quoteBox) return;

        state.defaultFamily = window.getComputedStyle(els.quoteBox).fontFamily;
        updateCurrentDisplay();

        const stored = getStoredSelection();
        if (stored) {
            state.selectedStack = stored.stack;
            state.selectedLabel = stored.label;
        }

        state.fonts = await buildFontCatalogue();
        renderList(state.fonts, els.search ? els.search.value : '');
        if (state.selectedStack) {
            applyFont(state.selectedStack, state.selectedLabel, { persist: false });
            highlightSelection();
        } else {
            updateCurrentDisplay();
        }

        els.list.addEventListener('click', handleSelection);
        if (els.search) {
            els.search.addEventListener('input', handleSearch);
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', prepare, { once: true });
    } else {
        prepare();
    }
})();

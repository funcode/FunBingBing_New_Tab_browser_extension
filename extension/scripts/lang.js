// Language detection 
function detectAndSetLang() {
    try {
        var supported = ['en','zh-CN','zh-TW'];
        var navLang = (navigator.language || navigator.userLanguage || 'en').trim();
        var normalized = navLang.toLowerCase();
        if (normalized === 'zh' || normalized.startsWith('zh-cn') || normalized.startsWith('zh-sg')) normalized = 'zh-CN';
        else if (normalized.startsWith('zh-tw') || normalized.startsWith('zh-hk') || normalized.startsWith('zh-mo')) normalized = 'zh-TW';
        else if (normalized.startsWith('en')) normalized = 'en';
        if (supported.indexOf(normalized) === -1) normalized = 'en';
        if (document.documentElement.lang !== normalized) {
            document.documentElement.setAttribute('lang', normalized);
        }
    } catch (e) { /* silent */ }
}

// i18n
function i18n(key) {
    return chrome.i18n.getMessage(key);
}
// page title
function i18n_page_title(){
    var fileName = (document.location.pathname.split('/').pop() || '').toLowerCase();
    document.title = i18n(fileName === 'options.html' ? 'op_title' : 'new_tab_title');
}

detectAndSetLang();
i18n_page_title();
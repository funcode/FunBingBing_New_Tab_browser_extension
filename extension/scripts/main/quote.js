const initQuoteInteractions = () => {
    const quote = document.querySelector('.quote');
    if (quote) quote.style.bottom = '15px';

    const hotspot = document.querySelector('.quote-hotspot');
    const popup = document.querySelector('.below');
    if (!quote || !hotspot || !popup) return;

    const quoteBody = quote.querySelector('.quote-body');
    const clock = document.getElementById('center-clock');

    const updateQuoteAlignment = () => {
        if (!quoteBody || !clock) return;
        const clockRect = clock.getBoundingClientRect();
        const quoteRect = quoteBody.getBoundingClientRect();
        if (!clockRect.width || !quoteRect.width) {
            quoteBody.style.removeProperty('--clock-align-offset');
            return;
        }

        const clockCenter = clockRect.left + clockRect.width / 2;
        const quoteCenter = quoteRect.left + quoteRect.width / 2;
        const offset = clockCenter - quoteCenter;
        quoteBody.style.setProperty('--clock-align-offset', `${offset.toFixed(2)}px`);
    };

    if (quoteBody && clock) {
        if (typeof ResizeObserver === 'function') {
            const clockResizeObserver = new ResizeObserver(updateQuoteAlignment);
            const quoteResizeObserver = new ResizeObserver(updateQuoteAlignment);
            clockResizeObserver.observe(clock);
            quoteResizeObserver.observe(quoteBody);
        }
        window.addEventListener('resize', updateQuoteAlignment);
        updateQuoteAlignment();
    }

    let openTimer = null;
    let closeTimer = null;
    const OPEN_DELAY = 120; // ms
    const CLOSE_DELAY = 160; // ms (longer to allow moving into popup)

    function open() {
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
        if (quote.classList.contains('q-open')) return;
        openTimer = setTimeout(() => {
            quote.classList.add('q-open');
        }, OPEN_DELAY);
    }

    function close() {
        if (openTimer) { clearTimeout(openTimer); openTimer = null; }
        closeTimer = setTimeout(() => {
            quote.classList.remove('q-open');
        }, CLOSE_DELAY);
    }

    hotspot.addEventListener('mouseenter', open);
    hotspot.addEventListener('mouseleave', close);
    popup.addEventListener('mouseenter', () => {
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    });
    popup.addEventListener('mouseleave', close);
    // Touch support: tap hotspot toggles
    hotspot.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (quote.classList.contains('q-open')) {
            quote.classList.remove('q-open');
        } else {
            quote.classList.add('q-open');
        }
    }, { passive: false });

    // Escape closes
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') quote.classList.remove('q-open');
    });
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initQuoteInteractions, { once: true });
} else {
    initQuoteInteractions();
}
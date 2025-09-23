document.addEventListener('DOMContentLoaded', () => {
    const quote = document.querySelector('.quote');
    if (quote) quote.style.bottom = '10px';

    const hotspot = document.querySelector('.quote-hotspot');
    const popup = document.querySelector('.below');
    if (!quote || !hotspot || !popup) return;

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
});
function handleQuoteLinkClick() {
const quoteBody = document.getElementById('quote-text');
if (!quoteBody || !quoteBody.textContent.trim()) {
    //Refetch data when opening a new tab
    localStorage.removeItem('wallpaper_date');
}
}

document.getElementById('quote-source-link').addEventListener('click', handleQuoteLinkClick);
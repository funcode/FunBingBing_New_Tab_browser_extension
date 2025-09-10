document.addEventListener('DOMContentLoaded', () => {
    const appDash = document.querySelector('.app-dash');
    if (!appDash) return;
    const below = appDash.querySelector('.below');
    if (!below) return;

    function updateLiftAndPosition() {
        // Compute lift height for hover animation
        const h = below.scrollHeight;
        appDash.style.setProperty('--lift', (h + 12) + 'px');

        // Keep a constant 10px bottom gap regardless of other elements
        const quote = document.querySelector('.quote');
        if (quote) {
            quote.style.bottom = '10px';
        }
    }

    updateLiftAndPosition();
    window.addEventListener('resize', updateLiftAndPosition);
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(updateLiftAndPosition).catch(()=>{});
    }
    const mo = new MutationObserver(updateLiftAndPosition);
    mo.observe(below, { childList: true, subtree: true, characterData: true });
});

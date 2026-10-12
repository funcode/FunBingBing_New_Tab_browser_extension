/**
 * Runtime storage names for the regular-only v2 pipeline (ADR-0015).
 * Production v1 keys are migration inputs and are intentionally not listed here.
 */
export const STORAGE_KEYS = Object.freeze({
  catalog: 'bing_wallpaper_catalog_v2',
  displayState: 'wallpaper_display_state_v2'
});

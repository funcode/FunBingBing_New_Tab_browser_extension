
// page title
function i18n_page_title(){
	document.title = i18n('new_tab_title');
}

// search logo hover tip
function i18n_search_logo_hover_tip() {
	document.getElementById("search-logo").title = i18n('search_logo_hover_tip');
}

// top-right check update btn
function i18n_tpr_check_update_btn() {
	document.getElementById('gallery-btn-text').innerHTML = i18n('tpr_gallery_btn');
}

// top-right open settings btn
function i18n_tpr_settings_btn() {
	document.getElementById('open-options-btn-text').innerHTML = i18n('tpr_settings_btn');
}



// // bottom-right uhd wallpaper badge 
// function i18n_btr_download_wallpaper_btn() {
// 	var x = document.getElementById('uhd-badge');
// 	x.innerHTML = i18n('btr_download_wallpaper_uhd_badge');
// }

// quiz label
function i18n_daily_quiz() {
    var el = document.getElementById('daily-quiz');
    if (el) el.innerHTML = i18n('daily_quiz');
}

// navigation buttons title
function i18n_nav_buttons() {
    var leftNav = document.getElementById('leftNav');
    var rightNav = document.getElementById('rightNav');
    if (leftNav) leftNav.title = i18n('prev_image');
    if (rightNav) rightNav.title = i18n('next_image');
}

function i18n_clock_toggle_button() {
    var clockToggle = document.getElementById('clock-toggle');
    if (clockToggle) clockToggle.title = i18n('toggle_clock_title');
}

function exec_i18n() {
	i18n_page_title();
	i18n_search_logo_hover_tip();
	i18n_tpr_check_update_btn();
	i18n_tpr_settings_btn();
    i18n_daily_quiz();
    i18n_nav_buttons();
    i18n_clock_toggle_button();
}

exec_i18n();

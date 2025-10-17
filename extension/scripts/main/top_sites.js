(function (global) {
	'use strict';

	const TOP_SITES_PERMISSION = { permissions: ['topSites'] };

	function noop() {}

	function isFunction(fn) {
		return typeof fn === 'function';
	}

	function callbackOrNoop(callback) {
		return isFunction(callback) ? callback : noop;
	}

	function isEnabled() {
		return readConf('show_top_sites') === 'yes';
	}

	function setEnabled(enabled) {
		writeConf('show_top_sites', enabled ? 'yes' : 'no');
	}

	function hasPermission(callback) {
		chrome.permissions.contains(TOP_SITES_PERMISSION, function (result) {
			callbackOrNoop(callback)(!!result);
		});
	}

	function ensureEnabled(callback) {
		if (!isEnabled()) {
			callbackOrNoop(callback)(false);
			return;
		}

		hasPermission(function (granted) {
			if (!granted) {
				setEnabled(false);
			}
			callbackOrNoop(callback)(granted);
		});
	}

	function requestPermission(callback) {
		chrome.permissions.request(TOP_SITES_PERMISSION, function (granted) {
			callbackOrNoop(callback)(!!granted);
		});
	}

	function removePermission(callback) {
		chrome.permissions.remove(TOP_SITES_PERMISSION, function (removed) {
			if (removed) {
				setEnabled(false);
			}
			callbackOrNoop(callback)(!!removed);
		});
	}

	global.TopSites = {
		isEnabled: isEnabled,
		setEnabled: setEnabled,
		hasPermission: hasPermission,
		ensureEnabled: ensureEnabled,
		requestPermission: requestPermission,
		removePermission: removePermission
	};
})(this);

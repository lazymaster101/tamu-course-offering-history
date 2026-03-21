let var_hasReportAccess = undefined;
let var_isExpert = undefined;
var eesyTemplates = {};
window.GlobalEesy = window.GlobalEesy || {};

delete window.GlobalEesy.Integration;

if (!sessionStorage.getItem('eesysoft_session')) {
	sessionStorage.setItem('eesysoft_session', Date.now().valueOf());
}

if (sessionStorage.getItem('eesysoft_active_account_id') === undefined) {
	sessionStorage.setItem('eesysoft_active_account_id', '-1');
}

if (!window.console) console = { log: function () {} };

function eesyLoadJs(src, isModule = false) {
	return new Promise((resolve) => {
		const script = document.createElement('script');
		script.type = isModule ? 'module' : 'text/javascript';
		script.src = src;
		script.async = true;
		script.addEventListener('load', resolve);
		document.head.append(script);
	});
}

function allowedBrowserBasedOnAgentPattern() {
	if (!window.doNotLoadEngineForUserAgentPattern || doNotLoadEngineForUserAgentPattern == '') return true;

	return !navigator.userAgent.match(doNotLoadEngineForUserAgentPattern);
}

function allowedBrowser() {
	return allowedBrowserBasedOnAgentPattern();
}

if (allowedBrowser()) {
	eesyLoadJs(`${var_dashboard_url}/v2/dist/jQueryPrivate.js?v=${var_eesy_build}`).then(init);
}

// This function is called directly from content
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function handleHelpItem(itemId) {
	createCustomEvent('helpitemHandle', { detail: { helpitemid: itemId } });
}

// todo: move handleHelpItemByGuid and handleHelpItemArticle into bundle (they are called in few places as global functions)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function handleHelpItemByGuid(guid, e) {
	// this is triggered when a popup link has been clicked inside the uef support center
	const detail = { helpitemGuid: guid };
	createCustomEvent('helpitemHandle', { detail });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function handleHelpItemArticle(guid) {
	createCustomEvent('helpitemArticleHandle', { detail: { helpitemGuid: guid } });
}

function createCustomEvent(eventName, data) {
	var event;
	if (window.CustomEvent) {
		event = new CustomEvent(eventName, data);
	} else {
		event = document.createEvent('CustomEvent');
		event.initCustomEvent(eventName, true, true, data);
	}
	const sendEvent = () => {
		if (window.ImpactEngine?.isInitialized) {
			document.dispatchEvent(event);
		} else {
			setTimeout(() => sendEvent(), 200);
		}
	};
	sendEvent(event);
}

function init() {
	function isDebugLocalAssets() {
		return sessionStorage.DEBUG_LOCAL_ASSETS === 'true';
	}

	function getDashboardUrl() {
		if (isDebugLocalAssets()) {
			return 'http://127.0.0.1:9666';
		}

		return var_dashboard_url;
	}

	function getResourceUrl() {
		if (isDebugLocalAssets()) {
			const scope = var_uefMode ? 'ultra' : 'base';
			return `http://127.0.0.1:9666/dashboardstyles/${scope}`;
		}

		return var_style_path;
	}

	if (window.sessionStorage.upstreamService) {
		window.GlobalEesy.Integration = {
			value: window.sessionStorage.upstreamService,
			type: 'state',
			source: 'page_load',
		};
	}

	const $ = $j_eesy;

	$(document).ajaxError(function (e, xhr, settings, exception) {
		console.error({ url: settings.url, exception });
	});

	var getCssUrl = function (basePath, filePath) {
		var args = [`__md5=${var_eesy_style_checksum}`, `__bn=${var_eesy_build}`, `__h=${location.host}`].join('&');

		return [basePath, filePath, '?', args].join('');
	};

	//
	//  Load the CSS
	//
	eesyLoadCss(getCssUrl(getDashboardUrl(), '/v2/dist/compiled/css/proactiveresources-base.min.css'));
	eesyLoadCss(getCssUrl(var_style_path, '/proactiveresources/style.css'));
	eesyLoadCss(getCssUrl(getResourceUrl(), '/style_v2/eesysoft-template/assets/css/support-center.min.css'));
	eesyLoadCss(getCssUrl(var_style_path, '/override-proactive.css'));
	eesyLoadCss(getCssUrl(getDashboardUrl(), '/v2/dist/compiled/css/support-center-theme-defaults.min.css'));
	if (window.CANVAS_ACTIVE_BRAND_VARIABLES) {
		//load styles that uses canvas brand variables only when those variables are available
		eesyLoadCss(getCssUrl(getDashboardUrl(), '/v2/dist/compiled/css/support-center-theme-canvas.min.css'));
	}

	//
	//  Load the templates
	//
	$.ajaxSetup({
		cache: true,
	});

	eesyInitUserValues(function () {
		const args = [
			`languageId=${var_language}`,
			`styleChecksum=${var_eesy_style_checksum}`,
			'static=true',
			`__=${location.host}`,
			isDebugLocalAssets() && `__stamp=${Date.now()}`,
		]
			.filter(Boolean)
			.join('&');
		const eesy_url_load_templates = `${var_dashboard_url}/rest/public/proactive/templates?${args}`;

		$.get(eesy_url_load_templates, function (json) {
			eesyTemplates = json;

			const isDebugMode = sessionStorage.DEBUG_LOCAL_ASSETS === 'true';
			const impactConfig = {
				hiddenHelpItems: var_eesy_hiddenHelpItems,
				seenHelpItems: var_eesy_helpitemsSeen,
				sessionAccess: var_eesy_sac,
				userData: var_user_map,
				languageId: var_language,
				expertUserLanguageId: var_expert_language,
				dbUpdateCount: var_eesy_dbUpdateCount,
				publicProfiles: typeof var_public_profiles !== 'undefined' ? var_public_profiles : [],
				defaultLocale: window.ENV?.BIGEASY_LOCALE ?? undefined,
				userRoles: window.ENV?.current_user_roles ?? [],
				isUltraMode: var_uefMode,
				styleTypes: var_eesy_styles ?? [],
				proactiveLmsStyle: var_proactive_lms,
				lmsSubaccountId: sessionStorage.eesysoft_active_account_id
					? Number(sessionStorage.eesysoft_active_account_id)
					: undefined,
				lmsType: window.sessionStorage.eesysoft_lms_type ?? 'unknown',
				isDarkMode: var_proactive_dark,
				stylesVersion: var_proactive_version,
				baseUrl: var_dashboard_url,
				templates: eesyTemplates,
				isUnobscureAttempt: attemptUnobscure,
				loadFileUrl: var_loadfile,
				buildNumber: var_eesy_build,
				isUltraModeOriginal: var_uefModeOriginal,
				sessionKey: var_key,
				sessionId: window.sessionStorage.eesysoft_session,
				stylesChecksum: var_eesy_style_checksum,
				currentCourseId: typeof eesy_course_id !== 'undefined' ? eesy_course_id : undefined,
				isLtiLunch: var_isLtiLaunch,
				isLtiEngineLaunched: var_ltiEngineIsPresent,
				isExpertUser: var_isExpert,
				shouldLoadExpertTools: var_loadExpertTool,
				isImpactChromePluginActive: var_isExpertToolChromePlugin,
				supportCenter: {
					button: {
						version: var_tab_version,
						visible: var_show_tab,
						moveLimit: supportTabMoveLimit,
						expandedWidth: eesy_maximizedTabWidth,
						collapsedWidth: eesy_minimizedTabWidth,
						positionRight: scrollbarRightAdjust,
						isCollapsed: supportTabMinimized,
						position: supportTabPosition,
						isDraggable: var_moveable_tab,
					},
					isUltraStyles: var_uefModeOriginalUseUefSupportCenter,
				},
				isSupportUrlObfuscationEnabled:
					typeof var_eesy_support_url_obfuscation !== 'undefined' ? var_eesy_support_url_obfuscation : true,
			};
			const impactSessionData = {
				instanceName: var_instance_name,
				stylePath: var_style_path,
				hasReportAccess: var_hasReportAccess,
			};

			const bundleHost = isDebugMode ? 'http://localhost:9776' : `${var_dashboard_url}/v2/dist`;
			const initImpact = () => {
				window.ImpactEngine.start(impactConfig, impactSessionData);
				createCustomEvent('engineLoaded', {});
			};
			if (!window.ImpactEngine) {
				const cacheBuster = isDebugMode ? `_=${Date.now()}` : `__bn=${var_eesy_build}`;
				eesyLoadJs(`${bundleHost}/impact.js?${cacheBuster}`, true).then(initImpact);
			} else {
				initImpact();
			}
		});
	});
}

function eesyLoadCss(url) {
	if (document.createStyleSheet) {
		document.createStyleSheet(url);
	} else {
		const link = document.createElement('link');
		link.type = 'text/css';
		link.href = url;
		link.rel = 'stylesheet';
		document.head.append(link);
	}
}

function eesySetRoleInactive(rolename) {
	for (var prop in var_eesy_sac) {
		if (var_eesy_sac[prop].rolename == rolename) {
			var_eesy_sac[prop].enabled = false;
		}
	}
}

function eesyIssueUserRequests() {
	const $ = $j_eesy;

	return [
		$.getJSON(
			var_dashboard_url +
				'/rest/userContext/hiddenHelpItems?sessionkey=' +
				var_key +
				'&userUpdated=' +
				var_eesy_userUpdated +
				'&s=' +
				window.sessionStorage.eesysoft_session +
				'&__=' +
				location.host,
			function (hiddenHelpItems) {
				var_eesy_hiddenHelpItems = hiddenHelpItems;
			}
		),

		$.getJSON(
			var_dashboard_url +
				'/rest/userContext/sessionAccessCache?sessionkey=' +
				var_key +
				'&userUpdated=' +
				var_eesy_userUpdated +
				'&s=' +
				window.sessionStorage.eesysoft_session +
				'&__=' +
				location.host,
			function (sac) {
				var_eesy_sac = sac;
				//
				// check if any of the roles in the sac should be deactivated
				//
				if (!(typeof var_eesy_inactive_roles === 'undefined')) {
					for (var i = 0; i < var_eesy_inactive_roles.length; i++) {
						eesySetRoleInactive(var_eesy_inactive_roles[i]);
					}
				}
			}
		),

		$.getJSON(
			var_dashboard_url +
				'/rest/userContext/helpItemsSeen?sessionkey=' +
				var_key +
				'&userUpdated=' +
				var_eesy_userUpdated +
				'&s=' +
				window.sessionStorage.eesysoft_session +
				'&__=' +
				location.host,
			function (helpitemsSeen) {
				var_eesy_helpitemsSeen = helpitemsSeen;
			}
		),
	];
}

function eesyInitUserValues(onUserValuesInited) {
	var_show_tab =
		(!!var_key || window.var_delay_login_until_support_requested) &&
		(var_show_tab_initial || var_user_map.isShowTab);
	var_eesy_userUpdated = var_user_map.userUpdatedStamp;
	var_language = var_user_map.languageId || -1;
	supportTabMinimized = var_user_map.isSupportTabMinimized;
	supportTabPosition = var_user_map.supportTabPosition;
	var_hasReportAccess = var_user_map.hasReportAccess;
	var_isExpert = var_user_map.isExpert;
	sessionStorage.setItem('eesy_isExpert', var_user_map.isExpert);
	const $ = $j_eesy;
	if (!!var_key) {
		$.when.apply($, eesyIssueUserRequests()).then(onUserValuesInited);
	} else {
		if (window.var_delay_login_until_support_requested) {
			onUserValuesInited();
		}
	}
}

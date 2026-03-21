(async function() {
    const PANORAMA_SERVER_URL = 'https://panorama-api.yuja.com';
    const panoramaIdentifierKey = '8d8a678a7cf723aad165af4c82b1f33b0bfedce5efd56dbd45e13a6dba9ea257';
    const PANORAMA_CDN_URL = 'https://cdn-panorama.yuja.com';

    window.PANORAMA_SERVER_URL = PANORAMA_SERVER_URL;
    window.panoramaIdentifierKey = panoramaIdentifierKey;
    window.PANORAMA_CDN_URL = PANORAMA_CDN_URL;

    function loadScript(url) {
        const script = document.createElement('script');
        script.src = url;
        document.head.appendChild(script);
    }

    try {
        const response = await fetch(`${PANORAMA_SERVER_URL}/panorama-visualizer/canvas`, {cache: 'no-store'});
        const scriptUrl = await response.text();
        loadScript(scriptUrl);
    } catch (e) {
        console.error('Failed to load Panorama: ', e);
    }
})();


var h5pScript=document.createElement('script');
h5pScript.setAttribute('charset','UTF-8');
h5pScript.setAttribute('src','https://h5p.com/canvas-resizer.js');
document.body.appendChild(h5pScript);



////////////////////////////////////////////////////
// DESIGNPLUS CONFIG                            //
////////////////////////////////////////////////////
DpPrimary = {
    lms: 'canvas',
    templateCourse: '374161',
    hideButton: true,
    enableWizard: false,
    hideLti: false,
    extendedCourse: '', // added in sub-account theme
    sharedCourse: '', // added from localStorage
    courseFormats: [],
    canvasRoles: [],
    canvasUsers: [],
    canvasCourseIds: [],
    plugins: [],
    excludedModules: [],
    includedModules: [],
    lang: 'en',
    specifiedAccounts: [
        {
            identifier: 'Mays School of Business',
            accounts: ['105', '605', '606', '607', '608', '609', '610'],
            customizationsType: 'Primary',
            customizationsCourseId: '374161',
        },
    ]
}

// merge with extended/shared customizations config
DpConfig = { ...DpPrimary, ...(window.DpConfig ?? {}) }

$(function () {
    const uriPrefix = (location.href.includes('.beta.')) ? 'beta.' : '';
    const toolsUri = (DpConfig.toolsUri) ? DpConfig.toolsUri : `https://${uriPrefix}designplus.ciditools.com/`;
    $.getScript(`${toolsUri}js/controller.js`);
});
////////////////////////////////////////////////////
// END DESIGNPLUS CONFIG                        //
////////////////////////////////////////////////////




(function () {
	'use strict';
	// configure trays
	const MentalHealthTray = {
		title: 'Mental Health', // the menu item or tray name, what users will see
		icon_svg: 'icon-pin',
		//svg_size: { height: '26px', width: '26px' },
		trayLinks: [{
				href: 'https://tx.ag/MentalHealthTAMU',
				title: 'Student Resources ',
				desc: 'From counseling and workshops to crisis care, we are here for you.'
			},
			{
				href: 'https://uhs.tamu.edu/mental-health/student-support.html',
				title: 'Counseling via Student Support',
				desc: 'Use Student Support to text, call or video with licensed counselors 24/7/365.'
			}
		],
		footer: `<img class="qr" alt="qr" src="https://lms.tamu.edu/getmedia/462d079e-d656-4478-b195-3c84ff97047a/Canvas_Template_Health_Support_App.png"/>
		<span class="qr-span">Scan the QR code to download<br> the Student Support app on a mobile device.</span>`
	}

	// leave this alone
	const globalNavCustomTray = t => {
		const n = t.title.replace(/\W/g, '_').toLowerCase(),
			s = `global_nav_${n}_tray`,
			i = 'ic-app-header__menu-list-item',
			e = `${i}--active`;
		var a = `<span id="${s}" style="display: none;">
					<span class="global-nav-custom-tray gnct-easing">
						<span role="region" aria-label="Global navigation tray" class="Global-navigation-tray">
							<span class="gcnt-tray-close-wrapper">
								<button id="${s}_close" type="button" role="button" tabindex="0" class="gcnt-tray-close-btn" style="margin:0px;">
									<span class="gcnt-tray-close-svg-wrapper">
										<svg name="IconX" viewBox="0 0 1920 1920" rotate="0" width="1em" height="1em" aria-hidden="true" role="presentation" focusable="false" class="dUOHu_bGBk dUOHu_drOs dUOHu_eXrk cGqzL_bGBk" style="width: 1em; height: 1em;"><g role="presentation"><path d="M797.319865 985.881673L344.771525 1438.43001 533.333333 1626.99182 985.881673 1174.44348 1438.43001 1626.99182 1626.99182 1438.43001 1174.44348 985.881673 1626.99182 533.333333 1438.43001 344.771525 985.881673 797.319865 533.333333 344.771525 344.771525 533.333333z" fill-rule="nonzero" stroke="none" stroke-width="1"></path></g></svg>
										<span class="gcnt-tray-close-txt">Close</span>
									</span>
								</button>
							</span>
							<div class="tray-with-space-for-global-nav">
								<div id="custom_${n}_tray" class="gnct-content-wrap">
									<h2 class="gcnt-tray-h1">${t.title}</h2><hr role="presentation"/>
									<ul class="gcnt-list">`;

		t.trayLinks.forEach((function (t) {
			a += `<li class="gcnt-list-item"><span class="gcnt-list-link-wrapper"><a target="_blank" rel="noopener" class="gcnt-list-link" href="${t.href}" role="button" tabindex="0">${t.title}</a></span>`, a += t.desc && t.desc.length > 1 ? `<p class="gcnt-link-desc">${t.desc}</p>` : "", a += "</li>"
		})), a += t.footer.length > 1 ? `<li class="gcnt-list-item"><hr role="presentation"/></li><li class="gcnt-list-item">${t.footer}</li>` : "", a += "</ul></div></div></span></span></span>";

		var l = $('#main'),
			o = $('#menu'),
			c = $('<li>', {
				id: `global_nav_${n}_menu`,
				class: `${i} rc-gnct`,
				html: `<button id="global_nav_${n}_link" role="button" class="ic-app-header__menu-list-link"><div id="global_nav_${n}_svg" class="menu-item-icon-container" role="presentaiton"></div><div class="menu-item__text">${t.title}</div></button>`
			});

		if (1 == /^icon-[a-z]/.test(t.icon_svg)) c.find(`#global_nav_${n}_svg`).append(
			`<svg xmlns="http://www.w3.org/2000/svg" fill="none" height="32" width="32" viewBox="810.47 785.71 782.98 820.96">
				<style>
					.st0 {fill: #FFFFFF;}
					.ic-app-header__menu-list-item.ic-app-header__menu-list-item--active .ic-app-header__menu-list-link .st0 {fill: #500000;}
				</style>
				<path class="st0" d="M1005.87 1155.52C981.032 1155.52 958.394 1142.5 946.775 1121.67C942.167 1113.45 945.172 1103.04 953.386 1098.43C961.6 1093.82 972.017 1096.83 976.625 1105.04C982.434 1115.26 993.653 1121.67 1006.07 1121.67C1018.49 1121.67 1029.71 1115.26 1035.52 1105.04C1040.13 1096.83 1050.55 1093.82 1058.76 1098.43C1066.97 1103.04 1069.98 1113.45 1065.37 1121.67C1053.35 1142.5 1030.71 1155.52 1005.87 1155.52Z"/>
				<path class="st0" d="M1356.66 1606.67C1347.24 1606.67 1339.63 1599.06 1339.63 1589.64V1422.16C1339.63 1359.86 1358.66 1298.96 1394.92 1245.67C1400.13 1237.86 1410.75 1235.85 1418.56 1241.06C1426.37 1246.27 1428.38 1256.89 1423.17 1264.7C1390.91 1312.18 1373.89 1366.67 1373.89 1421.96V1589.44C1373.69 1599.06 1366.07 1606.67 1356.66 1606.67Z"/>
				<path class="st0" d="M1068.58 1606.67C1059.16 1606.67 1051.55 1599.06 1051.55 1589.64V1474.05L928.545 1481.26C917.527 1482.27 906.709 1478.86 898.495 1471.65C890.081 1464.44 885.073 1454.62 884.272 1443.6L883.871 1437.59C881.267 1403.33 876.459 1341.83 872.051 1278.93L838.796 1275.52C828.579 1274.52 819.564 1268.51 814.556 1259.7C809.547 1250.88 809.147 1240.26 813.354 1231.05L854.021 1143.1C859.831 1130.28 862.836 1116.46 862.636 1102.23V1102.03V1092.42C862.636 1019.5 888.679 948.979 935.757 893.687C994.054 824.972 1079 785.707 1168.95 785.707C1169.55 785.707 1170.35 785.707 1170.95 785.707C1180.36 785.707 1187.98 793.52 1187.78 802.936C1187.78 812.351 1180.16 819.764 1170.75 819.764C1170.75 819.764 1170.75 819.764 1170.55 819.764C1169.95 819.764 1169.35 819.764 1168.74 819.764C1088.81 819.764 1013.49 854.622 961.6 915.723C919.731 964.805 896.492 1027.71 896.492 1092.42V1102.03C896.692 1121.47 892.686 1140.1 884.672 1157.53L845.808 1242.07L889.48 1246.47C897.694 1247.28 904.105 1254.09 904.706 1262.3C909.313 1329.81 914.522 1398.13 917.527 1434.99L917.928 1441C918.128 1443.4 919.33 1444.8 920.332 1445.81C921.133 1446.61 922.936 1447.81 925.741 1447.41C925.941 1447.41 926.141 1447.41 926.342 1447.41L1054.55 1439.8C1062.57 1439.39 1070.58 1442.2 1076.39 1447.81C1082.2 1453.42 1085.61 1461.03 1085.61 1469.04V1589.64C1085.61 1599.06 1077.99 1606.67 1068.58 1606.67Z"/>
				<path class="st0" d="M1371.68 1213.22C1369.28 1213.22 1366.88 1212.82 1364.67 1211.82C1303.77 1184.77 1251.48 1147.11 1213.42 1102.83C1172.75 1055.56 1150.72 1003.27 1149.91 951.784C1149.91 951.583 1149.91 951.583 1149.91 951.383V948.178C1149.91 873.253 1207.61 812.352 1278.33 812.352C1314.19 812.352 1347.64 827.777 1371.68 854.822C1395.72 827.978 1429.18 812.352 1465.04 812.352C1535.76 812.352 1593.45 873.253 1593.45 948.178V951.583C1593.45 951.784 1593.45 951.784 1593.45 951.984C1592.45 1003.47 1570.61 1055.76 1529.95 1103.04C1491.88 1147.31 1439.6 1184.97 1378.49 1212.02C1376.29 1212.82 1374.09 1213.22 1371.68 1213.22ZM1183.97 951.183C1185.57 1036.93 1259.1 1125.07 1371.68 1177.36C1484.27 1125.27 1557.79 1037.33 1559.4 951.383V948.178C1559.4 892.084 1517.13 846.408 1465.04 846.408C1433.19 846.408 1403.74 863.437 1386.31 892.084C1383.3 897.093 1377.69 900.298 1371.68 900.298C1365.67 900.298 1360.26 897.293 1357.06 892.084C1339.63 863.437 1310.18 846.408 1278.33 846.408C1226.24 846.408 1183.97 892.084 1183.97 948.178V951.183Z"/>
				<path class="st0" d="M1408.94 995.856H1388.71V975.622C1388.71 966.206 1381.1 958.594 1371.68 958.594C1362.27 958.594 1354.65 966.206 1354.65 975.622V995.856H1334.42C1325.01 995.856 1317.39 1003.47 1317.39 1012.88C1317.39 1022.3 1325.01 1029.91 1334.42 1029.91H1354.65V1050.15C1354.65 1059.56 1362.27 1067.17 1371.68 1067.17C1381.1 1067.17 1388.71 1059.56 1388.71 1050.15V1029.91H1408.94C1418.36 1029.91 1425.97 1022.3 1425.97 1012.88C1425.97 1003.47 1418.36 995.856 1408.94 995.856Z"/>
			</svg>`);
		else if (/^http/.test(t.icon_svg)) c.find(`#global_nav_${n}_svg`).load(t.icon_svg, (function () {
			let s = $(this).find('svg')[0],
				i = `global_nav_${n}_svg`;
			s.setAttribute('id', i), s.setAttribute('class', 'ic-icon-svg menu-item__icon ic-icon-svg--apps svg-icon-help ic-icon-svg-custom-tray'), 'object' == typeof t.svg_size && (s.setAttribute('height', t.svg_size.height), s.setAttribute('width', t.svg_size.width))
		}));
		else if (/^<svg/.test(t.icon_svg)) {
			c.append($(t.icon_svg));
			let s = c.find('svg')[0],
				i = `global_nav_${n}_svg`;
			s.setAttribute('id', i), s.setAttribute('class', 'ic-icon-svg menu-item__icon ic-icon-svg--apps svg-icon-help ic-icon-svg-custom-tray'), 'object' == typeof t.svg_size && (s.setAttribute('height', t.svg_size.height), s.setAttribute('width', t.svg_size.width))
		}

		function r() {
			o.find('button').each((function () {
				this.onmouseup = this.blur()
			})), a.find('.gnct-easing').animate({
				left: '-200px',
				opacity: .8
			}, 300, 'linear', (function () {
				a.hide(), c.removeClass(e)
			}))
		}
		o.append(c), l.append(a), c = $(`#global_nav_${n}_menu`), a = $(`#${s}`), c.click((function () {
			$(this).hasClass(e) ? r() : ($('.rc-gnct').not(c).click((function () {
				r()
			})), o.find('button').each((function () {
				this.onmouseup = this.blur()
			})), a.show(), a.find('.gnct-easing').animate({
				left: '0px',
				opacity: 1
			}, 300, 'linear', (function () {
				$(`.${i}`).removeClass(e), c.addClass(e)
			})))
		})), $(`.${i}`).not(c).click((function () {
			r()
		})), $(`#${s}_close`).click((function () {
			r()
		}))
	};

	globalNavCustomTray(MentalHealthTray);
})();

window.ALLY_CFG = {
	'baseUrl': 'https://prod.ally.ac',
	'clientId': 9231
};
$.getScript(ALLY_CFG.baseUrl + '/integration/canvas/ally.js');

/* Removes the ability for anyone other than admins to add an access token in /profile/settings */
    if (window.location.href.pathname = "/profile/settings" && window.ENV.current_user_roles.includes("admin")) {} else {
        $('.add_access_token_link').remove();
    }
window.rsConf = {docReader: {}};
(function() {
    jQuery.ajax({
        url: "//cdn-na.readspeaker.com/script/14810/webReaderForEducation/canvas/current/ReadSpeaker.Canvas.js",
        dataType: 'script',
        async: true,
        cache: true
    });
})();
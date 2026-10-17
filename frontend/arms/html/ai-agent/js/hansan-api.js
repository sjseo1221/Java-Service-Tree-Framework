/*
 * 한산 ver2 데이터 접근 — 서버 호출은 모두 여기 한 곳을 지난다.
 * jQuery 1.11 jqXHR 를 그대로 돌려준다(.done / .fail / .always 만 사용, .catch 없음).
 */
var hansanApi = (function ($) {
	"use strict";

	var BASE = "api/";

	function getJson(path, params) {
		return $.ajax({
			url: BASE + path,
			type: "GET",
			data: params,
			dataType: "json",
			cache: false
		});
	}

	return {
		/** jstree core.data.url 용 — id 는 jstree 가 data 함수로 덧붙인다 */
		treeUrl: function (operation) {
			return BASE + "tree?operation=" + encodeURIComponent(operation);
		},
		getContent: function (id) {
			return getJson("tree", { operation: "get_content", id: id });
		},
		getDates: function () {
			return getJson("dates");
		},
		getPlace: function (id, date) {
			return getJson("place", { id: id, date: date });
		},
		getLocale: function (lang) {
			return $.ajax({ url: "locales/" + lang + ".json", type: "GET", dataType: "json", cache: false });
		}
	};
})(jQuery);

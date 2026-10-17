/*
 * 한산 ver2 언어팩 — locales/{lang}.json(중첩)을 점 표기로 평탄화해 쓴다.
 * 찾는 순서: 선택 언어 → ko → ''. 누락은 키당 한 번 console.warn.
 * A-RMS common.js 의 setLocale 과 이름이 겹치지 않도록 hansanSetLocale / hansanT 를 쓴다.
 */
var HANSAN_LANGS = ["ko", "en"];
var HANSAN_DEFAULT_LANG = "ko";

var hansanLocale = {
	lang: HANSAN_DEFAULT_LANG,
	packs: {},
	warned: {}
};

function hansanNormalizeLang(lang) {
	var v = String(lang || "").toLowerCase();
	return $.inArray(v, HANSAN_LANGS) >= 0 ? v : HANSAN_DEFAULT_LANG;
}

function hansanFlatten(obj, prefix, out) {
	$.each(obj, function (k, v) {
		var key = prefix ? prefix + "." + k : k;
		if (v && typeof v === "object" && !$.isArray(v)) {
			hansanFlatten(v, key, out);
		} else {
			out[key] = v;
		}
	});
	return out;
}

function hansanLoadPack(lang) {
	if (hansanLocale.packs[lang]) {
		return $.Deferred().resolve(hansanLocale.packs[lang]).promise();
	}
	return hansanApi.getLocale(lang).then(function (data) {
		hansanLocale.packs[lang] = hansanFlatten(data || {}, "", {});
		return hansanLocale.packs[lang];
	});
}

/** 키 → 문구. params 의 {name} 을 치환한다 */
function hansanT(key, params) {
	var cur = hansanLocale.packs[hansanLocale.lang] || {};
	var def = hansanLocale.packs[HANSAN_DEFAULT_LANG] || {};
	var text = cur[key];
	if (text == null) {
		text = def[key];
	}
	if (text == null) {
		if (!hansanLocale.warned[key]) {
			hansanLocale.warned[key] = true;
			console.warn("[ hansan :: hansanT ] missing", key);
		}
		return "";
	}
	if (!params) {
		return text;
	}
	return String(text).replace(/\{(\w+)\}/g, function (m, name) {
		return params.hasOwnProperty(name) && params[name] != null ? String(params[name]) : m;
	});
}

/** [data-locale] 요소의 글자를 현재 언어로 다시 채운다 */
function hansanApplyLocale(root) {
	$(root || document)
		.find("[data-locale]")
		.each(function () {
			$(this).text(hansanT($(this).attr("data-locale")));
		});
	document.title = hansanT("hansan.page.title");
}

/** 기본 언어(ko)와 선택 언어를 함께 로드한 뒤 바인딩. 실패해도 always 로 이어 갈 수 있다 */
function hansanSetLocale(lang) {
	var target = hansanNormalizeLang(lang);
	var jobs = [hansanLoadPack(HANSAN_DEFAULT_LANG)];
	if (target !== HANSAN_DEFAULT_LANG) {
		jobs.push(hansanLoadPack(target));
	}
	return $.when.apply($, jobs).then(function () {
		hansanLocale.lang = target;
		document.documentElement.setAttribute("lang", target);
		hansanApplyLocale(document);
		return target;
	});
}

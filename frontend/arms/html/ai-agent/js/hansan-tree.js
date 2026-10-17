/*
 * 한산 ver2 페이지 스크립트 — 트리(jstree 3.3.3, 조회 전용) · 상세 패널 · 날짜 · 언어.
 * 진입점은 A-RMS 관례대로 전역 execDocReady(). 데이터는 .text() 로만 넣는다(.html() 금지).
 */
var LH_MARK = { high: "●●●", medium: "●●○", low: "●○○" };

var hansanState = {
	seq: 0, // 상세 요청 순번 — 최신 응답만 반영
	nodeId: null, // 선택한 노드 id
	date: null, // 선택 날짜
	dates: null, // /api/dates 응답
	view: { kind: "pick" } // 언어 전환 때 다시 그릴 상세 상태
};

// ---------- 공통 ----------

function hansanQuery(name) {
	var m = new RegExp("[?&]" + name + "=([^&#]*)").exec(window.location.search);
	if (!m) {
		return null;
	}
	try {
		return decodeURIComponent(m[1].replace(/\+/g, " "));
	} catch (e) {
		return null;
	}
}

function syncUrl() {
	var q = "?lang=" + encodeURIComponent(hansanLocale.lang) + (hansanState.date ? "&date=" + encodeURIComponent(hansanState.date) : "");
	if (window.history && window.history.replaceState) {
		window.history.replaceState(null, "", window.location.pathname + q);
	}
}

function isPlaceId(id) {
	return !/^(prov|sgg)-/.test(id);
}

function noData() {
	return hansanT("hansan.common.noData");
}

function pctTop(pct) {
	if (pct == null) {
		return noData();
	}
	return hansanT("hansan.format.topPct", { n: Math.max(1, Math.round(100 - pct)) });
}

function changePct(x) {
	if (x == null) {
		return noData();
	}
	var n = Math.round(x * 100);
	return hansanT("hansan.format.changePct", { sign: n > 0 ? "+" : n < 0 ? "-" : "", n: Math.abs(n) });
}

function formatDate(d) {
	var p = d.split("-");
	var w = new Date(d + "T00:00:00Z").getUTCDay();
	return hansanT("hansan.format.date", {
		m: parseInt(p[1], 10),
		d: parseInt(p[2], 10),
		w: hansanT("hansan.weekday." + w)
	});
}

// ---------- 날짜 ----------

function renderDateOptions() {
	var $sel = $("#date_select").empty();
	if (!hansanState.dates) {
		return;
	}
	$.each(hansanState.dates.dates, function (i, d) {
		var text = formatDate(d) + (d === hansanState.dates.today ? " " + hansanT("hansan.format.today") : "");
		$("<option>").val(d).text(text).appendTo($sel);
	});
	$sel.val(hansanState.date);
}

function loadDates() {
	return hansanApi.getDates().done(function (data) {
		hansanState.dates = data;
		var q = hansanQuery("date");
		hansanState.date = q && $.inArray(q, data.dates) >= 0 ? q : data.defaultDate;
		renderDateOptions();
		syncUrl();
	});
}

// ---------- 트리 ----------

function onTreeError() {
	var $box = $("#tree_error").empty().removeClass("hidden");
	var $alert = $("<div>").addClass("alert alert-danger").appendTo($box);
	$("<span>").attr("data-locale", "hansan.tree.error").text(hansanT("hansan.tree.error")).appendTo($alert);
	$("<button>")
		.attr({ type: "button", id: "tree_retry_btn", "data-locale": "hansan.tree.retry" })
		.addClass("btn btn-default btn-sm pull-right")
		.text(hansanT("hansan.tree.retry"))
		.appendTo($alert);
}

function buildTree() {
	$("#place_tree")
		.jstree({
			core: {
				data: {
					url: hansanApi.treeUrl("get_node"),
					data: function (node) {
						return { id: node.id };
					}
				},
				multiple: false,
				check_callback: false,
				themes: { responsive: true },
				strings: { "Loading ...": hansanT("hansan.tree.loading") },
				error: onTreeError,
				// jstree 기본값은 blob: URL Web Worker 로 파싱 — CSP(default-src 'self')가 막으므로 메인 스레드에서 처리
				worker: false
			},
			force_text: true,
			plugins: ["wholerow"]
		})
		.on("changed.jstree", function (e, data) {
			// API select_node 는 multiple:false 여도 기존 선택을 지우지 않으므로 방금 선택된 노드를 쓴다
			if (data.action === "select_node" && data.node) {
				showDetail(data.node.id);
			}
		});

	$("#tree_error").on("click", "#tree_retry_btn", function () {
		$("#tree_error").addClass("hidden").empty();
		$("#place_tree").jstree(true).refresh();
	});
}

// ---------- 상세 ----------

function setView(view) {
	hansanState.view = view;
	renderView();
}

function renderView() {
	var v = hansanState.view;
	var $body = $("#detail_body").empty();
	if (v.kind === "data") {
		renderDetail($body, v.data);
		return;
	}
	if (v.kind === "error") {
		$("<div>").addClass("alert alert-danger").text(hansanT(v.key)).appendTo($body);
		return;
	}
	$("<p>")
		.addClass("text-muted")
		.text(hansanT(v.kind === "loading" ? "hansan.detail.loading" : "hansan.detail.pickPlace"))
		.appendTo($body);
}

function showDetail(id) {
	var my = ++hansanState.seq;
	hansanState.nodeId = id;
	$("#detail_path").text("");
	renderAsOf(null);

	hansanApi
		.getContent(id)
		.done(function (r) {
			if (my === hansanState.seq) {
				$("#detail_path").text(String(r.content).split("/").join(" › "));
			}
		})
		.fail(function () {
			// 경로 줄은 보조 정보라 실패하면 비워 두기만 한다. 상세 본문 오류는 아래에서 따로 표시한다
			if (my === hansanState.seq) {
				$("#detail_path").text("");
			}
		});

	if (!isPlaceId(id)) {
		setView({ kind: "pick" });
		return;
	}
	if (!hansanState.date) {
		setView({ kind: "error", key: "hansan.detail.error" });
		return;
	}
	setView({ kind: "loading" });
	hansanApi
		.getPlace(id, hansanState.date)
		.done(function (data) {
			if (my === hansanState.seq) {
				setView({ kind: "data", data: data });
				renderAsOf(data);
			}
		})
		.fail(function (xhr) {
			if (my === hansanState.seq) {
				var noDate = xhr.status === 404 && xhr.responseText === "Not Found: date";
				setView({ kind: "error", key: noDate ? "hansan.detail.noDateData" : "hansan.detail.error" });
			}
		});
}

function renderAsOf(data) {
	if (!data) {
		$("#data_asof").text("");
		return;
	}
	$("#data_asof").text(
		hansanT("hansan.footer.asof", {
			score: data.score && data.score.asOf ? data.score.asOf : noData(),
			reco: data.recommendation && data.recommendation.asOf ? data.recommendation.asOf : noData()
		})
	);
}

function addRow($dl, labelKey, value) {
	$("<dt>").text(hansanT(labelKey)).appendTo($dl);
	return $("<dd>").text(value).appendTo($dl);
}

function sectionTitle($body, key) {
	$("<h5>").text(hansanT(key)).appendTo($body);
}

function renderBasic($body, p) {
	sectionTitle($body, "hansan.section.basic");
	var noInfo = hansanT("hansan.common.noInfo");
	var op = p.operation || {};
	var $dl = $("<dl>").addClass("dl-horizontal").appendTo($body);
	addRow($dl, "hansan.field.address", p.address || noInfo);
	addRow($dl, "hansan.field.region", p.provinceName + " " + p.signgu);
	addRow($dl, "hansan.field.category", p.category ? hansanT("hansan.category." + p.category) || p.category : noInfo);
	addRow($dl, "hansan.field.indoor", p.indoor ? hansanT("hansan.indoor." + p.indoor) || p.indoor : noInfo);
	addRow($dl, "hansan.field.rest", op.rest || noInfo);
	addRow($dl, "hansan.field.hours", op.hours || noInfo);
	$("<p>").addClass("help-block").text(hansanT("hansan.detail.checkBefore")).appendTo($body);
	if (p.stale) {
		$("<div>")
			.addClass("alert alert-warning")
			.text(hansanT("hansan.detail.stale", { date: p.staleSince || noData() }))
			.appendTo($body);
	}
}

function renderScore($body, s, signgu) {
	sectionTitle($body, "hansan.section.score");
	if (!s) {
		$("<p>").addClass("text-muted").text(hansanT("hansan.score.none")).appendTo($body);
		return;
	}
	var nav = noData();
	if (s.navRank != null) {
		nav = hansanT("hansan.format.rank", { area: signgu, n: s.navRank }) + (s.navPct != null ? " (" + pctTop(s.navPct) + ")" : "");
	} else if (s.navPct != null) {
		nav = pctTop(s.navPct);
	}
	var pattern = s.patternLabel === "실측" ? "hansan.pattern.measured" : s.patternLabel === "추정" ? "hansan.pattern.estimated" : null;

	var rows = [
		["hansan.score.popularity", pctTop(s.popularity)],
		["hansan.score.search", pctTop(s.searchPct)],
		["hansan.score.blog", pctTop(s.blogPct)],
		["hansan.score.nav", nav],
		["hansan.score.trend", changePct(s.trend)],
		["hansan.score.longTerm", changePct(s.longTerm)],
		["hansan.score.pattern", pattern ? hansanT(pattern) : noData()]
	];
	var $tbody = $("<tbody>");
	$.each(rows, function (i, r) {
		$("<tr>").append($("<th>").attr("scope", "row").text(hansanT(r[0])), $("<td>").text(r[1])).appendTo($tbody);
	});
	$("<div>")
		.addClass("table-responsive")
		.append($("<table>").addClass("table table-condensed").append($tbody))
		.appendTo($body);
}

function renderReco($body, reco) {
	sectionTitle($body, "hansan.section.reco");
	if (reco.asOf) {
		$("<p>").addClass("text-muted small").text(hansanT("hansan.reco.asOf", { date: reco.asOf })).appendTo($body);
	}
	if (reco.status === "candidate") {
		$("<p>").text(hansanT("hansan.reco.candidate")).appendTo($body);
		return;
	}
	if (reco.status !== "recommended" || !reco.item) {
		$("<p>").addClass("text-muted").text(hansanT("hansan.reco.none")).appendTo($body);
		return;
	}

	var it = reco.item;
	var $dl = $("<dl>").addClass("dl-horizontal").appendTo($body);

	var $lh = addRow($dl, "hansan.reco.likelihood", "");
	if (it.likelihood && LH_MARK[it.likelihood]) {
		$lh.addClass("lh-" + it.likelihood);
		$("<span>").addClass("lh-mark").attr("aria-hidden", "true").text(LH_MARK[it.likelihood]).appendTo($lh);
		$("<span>").text(hansanT("hansan.likelihood." + it.likelihood)).appendTo($lh);
	} else {
		$lh.text(noData());
	}

	addRow($dl, "hansan.reco.forecast", it.forecast != null ? String(Math.round(it.forecast)) : noData());
	addRow($dl, "hansan.reco.usual", it.usual != null ? String(Math.round(it.usual)) : hansanT("hansan.reco.usualPending"));
	addRow($dl, "hansan.reco.slot", it.slot && it.slot.start && it.slot.end ? it.slot.start + "~" + it.slot.end : noData());

	// 유형 배지 — 대표 유형 먼저
	var types = (it.types || []).slice();
	if (it.representative) {
		types = [it.representative].concat(
			$.grep(types, function (t) {
				return t !== it.representative;
			})
		);
	}
	var $types = addRow($dl, "hansan.reco.types", "");
	$.each(types, function (i, t) {
		$("<span>")
			.addClass("label " + (i === 0 ? "label-primary" : "label-default"))
			.text(hansanT("hansan.type." + t + ".label") || t)
			.appendTo($types);
	});
	if (it.beta) {
		$("<span>").addClass("label label-warning").text(hansanT("hansan.reco.beta")).appendTo($types);
	}
	if (!types.length && !it.beta) {
		$types.text(noData());
	}

	var $reason = addRow($dl, "hansan.reco.reason", "");
	if (it.reason) {
		$reason.text(it.reason);
	} else {
		if (it.representative) {
			$("<span>").text(hansanT("hansan.type." + it.representative + ".desc")).appendTo($reason);
		}
		$("<small>").addClass("help-block").text(hansanT("hansan.reco.reasonPending")).appendTo($reason);
	}
}

function renderDetail($body, data) {
	renderBasic($body, data.place);
	renderScore($body, data.score, data.place.signgu);
	renderReco($body, data.recommendation);
}

// ---------- 언어 ----------

function changeLang(lang) {
	hansanSetLocale(lang).always(function () {
		$("#lang_select").val(hansanLocale.lang);
		var tree = $("#place_tree").jstree(true);
		if (tree) {
			tree.settings.core.strings["Loading ..."] = hansanT("hansan.tree.loading");
		}
		renderDateOptions();
		renderView();
		renderAsOf(hansanState.view.kind === "data" ? hansanState.view.data : null);
		syncUrl();
	});
}

// ---------- 진입 ----------

function execDocReady() {
	var lang = hansanNormalizeLang(hansanQuery("lang"));
	hansanSetLocale(lang).always(function () {
		$("#lang_select").val(hansanLocale.lang);
		renderView();
		loadDates()
			.done(function () {
				// 날짜보다 먼저 장소를 골랐으면 날짜가 도착한 뒤 다시 그린다
				if (hansanState.nodeId) {
					showDetail(hansanState.nodeId);
				}
			})
			.fail(function () {
				setView({ kind: "error", key: "hansan.detail.error" });
			});
		buildTree();
	});

	$("#date_select").on("change", function () {
		hansanState.date = $(this).val();
		syncUrl();
		if (hansanState.nodeId) {
			showDetail(hansanState.nodeId);
		}
	});

	$("#lang_select").on("change", function () {
		changeLang($(this).val());
	});

	$("#toolbar_form").on("submit", function (e) {
		e.preventDefault();
	});
}

$(execDocReady);

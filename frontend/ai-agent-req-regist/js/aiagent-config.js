/*
 * AIAGENT 화면 설정값. 화면 문구는 두지 않는다(언어팩 키만).
 * 이식 시: mode 를 'live' 로 바꾸면 api.js 가 실제 /api/aiagent 경로를 호출한다.
 */
(function (w) {
  'use strict';

  var A = (w.AIAGENT = w.AIAGENT || {});

  A.config = {
    mode: 'mock', // 'mock' | 'live'
    apiBase: '/api/aiagent',
    mockBase: 'mock/',
    docsBase: '/__docs/', // tools/serve.mjs 별칭 → 저장소 docs/file/
    mockLatencyMs: 150,

    defaultLang: 'ko',
    langs: ['ko', 'en', 'ja'],
    langAlias: { jp: 'ja' },

    defaultSid: 1001,

    minPollSec: 5, // CON-07 · REQ-F-016 C2: 하한 5초
    pollSec: { job: 5, execution: 5, monitor: 10 },

    upload: { ext: '.xlsx', maxBytes: 20 * 1024 * 1024, maxRows: 500 },
    previewPageSize: 50,

    // 상단 10단계(REQ-F-021). 텍스트는 aiagent.flow.stage.{no}.* 키로만 표시한다.
    stages: [
      { no: 1, code: 'UPLOAD', icon: 'upload' },
      { no: 2, code: 'REGISTER', icon: 'register' },
      { no: 3, code: 'REVIEW', icon: 'review' },
      { no: 4, code: 'SRS_GENERATE', icon: 'doc-gen' },
      { no: 5, code: 'SRS_CONFIRM', icon: 'doc-check' },
      { no: 6, code: 'SDS_CONFIRM', icon: 'doc-check' },
      { no: 7, code: 'BACKLOG', icon: 'list' },
      { no: 8, code: 'ASSIGN', icon: 'worker' },
      { no: 9, code: 'EXECUTE', icon: 'play' },
      { no: 10, code: 'MONITOR', icon: 'monitor' }
    ],

    // SDS §8 오류 카탈로그 22종. 문구는 aiagent.error.{code}
    errorCodes: [
      'AGT-GATE-001', 'AGT-GATE-002', 'AGT-GATE-003',
      'AGT-VAL-001', 'AGT-VAL-002', 'AGT-VAL-003', 'AGT-VAL-004', 'AGT-VAL-005',
      'AGT-AUTH-001', 'AGT-AUTH-002',
      'AGT-SCOPE-001', 'AGT-SCOPE-002',
      'AGT-PATH-001',
      'AGT-IMM-001',
      'AGT-STATE-001', 'AGT-STATE-002',
      'AGT-JOB-001', 'AGT-JOB-002',
      'AGT-EXT-001', 'AGT-EXT-002',
      'AGT-AUDIT-001',
      'AGT-I18N-001'
    ]
  };
})(window);

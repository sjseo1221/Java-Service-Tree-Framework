/*
 * 주기 폴링(설계서 §2.9). 간격은 config.minPollSec(5초) 미만으로 내려가지 않는다(CON-07).
 * 문서가 hidden 이면 그 회차를 건너뛰고, 화면 이탈(view unmount · router 전환) 시 stop 한다.
 *   var p = AIAGENT.poller.start(fn, sec);  p.stop();
 */
(function (w) {
  'use strict';

  var A = (w.AIAGENT = w.AIAGENT || {});
  var active = [];

  A.poller = {
    start: function (fn, sec) {
      var min = A.config.minPollSec;
      var ms = Math.max(Number(sec) || min, min) * 1000;
      var handle = { stopped: false, timer: null };

      function schedule() {
        if (!handle.stopped) handle.timer = setTimeout(tick, ms);
      }

      function tick() {
        if (handle.stopped) return;
        if (document.hidden) {
          schedule();
          return;
        }
        Promise.resolve()
          .then(fn)
          .catch(function () {
            /* 오류 표시는 fn 이 담당한다 */
          })
          .then(schedule);
      }

      handle.stop = function () {
        handle.stopped = true;
        clearTimeout(handle.timer);
        var i = active.indexOf(handle);
        if (i >= 0) active.splice(i, 1);
      };

      active.push(handle);
      schedule();
      return handle;
    },

    /**
     * 비동기 작업(API-601) 추적. config.pollSec.job 간격으로 조회해 onUpdate(job) 를 부르고,
     * SUCCEEDED 면 resolve(job), FAILED 면 reject({code: job.error}) 한다. 화면 이탈 시 stopAll 로 함께 정지된다.
     *   var w = AIAGENT.poller.watchJob(jobId, onUpdate);  w.promise.then(...);  w.stop();
     */
    watchJob: function (jobId, onUpdate) {
      var handle = null;
      var promise = new Promise(function (resolve, reject) {
        handle = A.poller.start(function () {
          return A.api.request('GET', '/jobs/' + encodeURIComponent(jobId)).then(
            function (job) {
              if (onUpdate) onUpdate(job);
              if (job.state === 'SUCCEEDED') {
                handle.stop();
                resolve(job);
              } else if (job.state === 'FAILED') {
                handle.stop();
                reject({ status: 500, code: job.error || 'AGT-JOB-001', message: job.error || 'AGT-JOB-001', details: [jobId] });
              }
            },
            function (err) {
              handle.stop();
              reject(err);
            }
          );
        }, A.config.pollSec.job);
      });
      return {
        promise: promise,
        stop: function () {
          handle.stop();
        }
      };
    },

    stopAll: function () {
      active.slice().forEach(function (p) {
        p.stop();
      });
    }
  };
})(window);

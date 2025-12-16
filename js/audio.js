(() => {
  "use strict";
  const RP = (window.RP = window.RP || {});
  // 今は未対応：呼ばれても落ちないためのダミー
  RP.Audio = Object.freeze({
    init() {},
    setVolumes() {},
    playBgm() {},
    stopBgm() {},
    playSe() {},
    pauseAll() {},
    resumeAll() {},
  });
})();

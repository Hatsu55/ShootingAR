// src/apriltag-wrapper.js
// APRILTAG WRAPPER BUILD v0.5
//
// - mod._atagjs_* を直接叩く
// - setImgBuffer の呼び方は既に ptr,w,h で OK と分かったのでそれを固定
// - 「nthreads > 0 を満たす set_detector_options の正しい並び」と
//   「detect() の正しい並び」を “同時に” 総当たりして特定
// - 成功した組み合わせを CHOSEN として保持し、以降それで回す
//
// ここで “CHOSEN” が決まれば、次のステップで本当に検出結果を JS に戻す最終 detect() を実装します。

export async function createAprilTag(mod, opts = {}) {
  const defaults = {
    tagSizeM: 0.20,
    nThreads: 1,
    quadDecimate: 1.0,
    quadSigma: 0.0,
    refineEdges: 1,
    decodeSharpening: 0.25
  };
  const cfg = { ...defaults, ...opts };

  const dbg = (msg) => {
    const el = document.getElementById('debugInfo');
    if (el) el.textContent += msg + '\n';
    console.log(msg);
  };

  dbg('APRILTAG WRAPPER BUILD v0.5');

  const getFn = (...names) => {
    for (const n of names) {
      const fn = mod[n];
      if (typeof fn === 'function') return fn;
    }
    return null;
  };

  const f = {
    init:         getFn('_atagjs_init',                 'atagjs_init'),
    destroy:      getFn('_atagjs_destroy',              'atagjs_destroy'),
    setOptions:   getFn('_atagjs_set_detector_options', 'atagjs_set_detector_options'),
    setPoseInfo:  getFn('_atagjs_set_pose_info',        'atagjs_set_pose_info'),
    setImgBuffer: getFn('_atagjs_set_img_buffer',       'atagjs_set_img_buffer'),
    setTagSize:   getFn('_atagjs_set_tag_size',         'atagjs_set_tag_size'),
    detect_raw:   getFn('_atagjs_detect',               'atagjs_detect'),
    malloc:       mod._malloc,
    free:         mod._free
  };

  if (!f.detect_raw || !f.setImgBuffer || !f.malloc || !f.free) {
    throw new Error('[apriltag-wrapper] 必須関数（detect,setImgBuffer,malloc,free）が見つかりません。');
  }

  try { f.init?.(); } catch (e) { dbg('[atag] init failed but continue: ' + e.message); }

  try { f.setTagSize?.(cfg.tagSizeM); } catch (e) { dbg('[atag] setTagSize failed but continue: ' + e.message); }

  const state = {
    mod,
    f,
    setImgPattern: 'ptr,w,h',  // これは確定済み
    setOptPattern: null,
    detectPattern: null
  };

  await probeOptionsAndDetect(state, cfg, dbg);

  return {
    async detect(gray, w, h) {
      const { mod, f } = state;

      // フレーム毎に “安全側で” オプションも入れておく
      callSetOptions(state, cfg);

      const size = w * h;
      const ptr = f.malloc(size);
      mod.HEAPU8.set(gray, ptr);

      try {
        callSetImg(state, { ptr, w, h });
        const ret = callDetect(state, { ptr, w, h });

        return {
          rawReturn: ret,
          length: typeof ret === 'number' && ret >= 0 ? ret : 0,
          pattern: {
            detect: state.detectPattern,
            setOpt: state.setOptPattern,
            setImg: state.setImgPattern
          }
        };
      } finally {
        f.free(ptr);
      }
    },

    getChosenPattern() {
      return {
        detect: state.detectPattern,
        setOpt: state.setOptPattern,
        setImg: state.setImgPattern
      };
    },

    destroy() {
      try { f.destroy?.(); } catch {}
    }
  };
}

// -------------------------------- helpers --------------------------------

function callSetImg(state, { ptr, w, h }) {
  const { f } = state;
  switch (state.setImgPattern) {
    case 'ptr,w,h': return f.setImgBuffer(ptr, w, h);
    default: throw new Error('unknown setImgPattern ' + state.setImgPattern);
  }
}

function callSetOptionsRaw(f, pattern, cfg) {
  const n  = cfg.nThreads || 1;
  const qd = cfg.quadDecimate || 1.0;
  const qs = cfg.quadSigma || 0.0;
  const re = cfg.refineEdges ? 1 : 0;
  const ds = cfg.decodeSharpening || 0.25;

  switch (pattern) {
    case '(none)':               return;
    case 'n':                    return f.setOptions(n);
    case 'n,qd,qs,re,ds':        return f.setOptions(n, qd, qs, re, ds);
    case 'qd,qs,re,ds,n':        return f.setOptions(qd, qs, re, ds, n);
    case 'n,0,0,0,0,0':          return f.setOptions(n, 0, 0, 0, 0, 0);
    case '0,0,0,0,0,n':          return f.setOptions(0, 0, 0, 0, 0, n);
    case 'n,qd,qs,re,ds,0':      return f.setOptions(n, qd, qs, re, ds, 0);
    case 'qd,qs,re,ds,0,n':      return f.setOptions(qd, qs, re, ds, 0, n);
    default: throw new Error('unknown setOptPattern ' + pattern);
  }
}

function callSetOptions(state, cfg) {
  const { f } = state;
  if (!f.setOptions || !state.setOptPattern) return;
  return callSetOptionsRaw(f, state.setOptPattern, cfg);
}

function callDetectRaw(f, pattern, { ptr, w, h }) {
  switch (pattern) {
    case 'none':        return f.detect_raw();
    case 'ptr,w,h':     return f.detect_raw(ptr, w, h);
    case 'w,h,ptr':     return f.detect_raw(w, h, ptr);
    case 'w,h':         return f.detect_raw(w, h);
    case 'ptr':         return f.detect_raw(ptr);
    default: throw new Error('unknown detectPattern ' + pattern);
  }
}

function callDetect(state, args) {
  const { f } = state;
  return callDetectRaw(f, state.detectPattern, args);
}

async function probeOptionsAndDetect(state, cfg, dbg) {
  const { mod, f } = state;

  const w = 64, h = 64, size = w * h;
  const ptr = f.malloc(size);
  mod.HEAPU8.fill(0, ptr, ptr + size);

  const detectCandidates = ['none', 'ptr,w,h', 'w,h,ptr', 'w,h', 'ptr'];
  const setOptCandidates = f.setOptions
    ? [
        'n',
        'n,qd,qs,re,ds',
        'qd,qs,re,ds,n',
        'n,0,0,0,0,0',
        '0,0,0,0,0,n',
        'n,qd,qs,re,ds,0',
        'qd,qs,re,ds,0,n'
      ]
    : ['(none)'];

  const logs = [];
  let chosen = null;

  for (const optP of setOptCandidates) {
    try {
      callSetOptionsRaw(f, optP, cfg);
    } catch (e) {
      logs.push(`[probe setOpt] ${optP} -> error: ${e.message}`);
      continue;
    }

    try {
      // setImg は固定
      state.setImgPattern = 'ptr,w,h';
      callSetImg(state, { ptr, w, h });
    } catch (e) {
      logs.push(`[probe setImg] ptr,w,h -> error: ${e.message}`);
      continue;
    }

    for (const detP of detectCandidates) {
      try {
        const ret = callDetectRaw(f, detP, { ptr, w, h });
        logs.push(`[probe detect] setOpt=${optP} / det=${detP} -> ret=${ret}`);
        if (typeof ret === 'number' && ret >= 0 && !chosen) {
          chosen = { setOptPattern: optP, detectPattern: detP, ret };
        }
      } catch (e) {
        logs.push(`[probe detect] setOpt=${optP} / det=${detP} -> error: ${e.message}`);
      }
    }
  }

  if (dbg) {
    dbg('\n=== PROBE LOG (setOptions + detect) ===\n' + logs.join('\n'));
    dbg('CHOSEN: ' + (chosen ? JSON.stringify(chosen) : 'none'));
  } else {
    console.log('[apriltag-wrapper] PROBE LOG:\n' + logs.join('\n'));
    console.log('CHOSEN:', chosen);
  }

  f.free(ptr);

  if (!chosen) {
    throw new Error('detect の呼び出しシグネチャを決められませんでした（nthreads の位置特定にも失敗）。今表示されている PROBE LOG を丸ごと貼ってください。');
  }

  state.setOptPattern = chosen.setOptPattern;
  state.detectPattern = chosen.detectPattern;
}

// Only the official SDK runs here. Login credentials never enter the webview.
export interface CaptchaConfig { region: string; prefix: string; sceneId: string }
interface Instance { startTracelessVerification?: () => void; destroy?: () => void }
interface Failure { success?: boolean; verifyResult?: boolean; verifyCode?: string; VerifyCode?: string; captchaVerifyParam?: string; CaptchaVerifyParam?: string }
interface Options {
  SceneId: string; mode: string; language: string; showErrorTip: boolean; element: string; button: string;
  getInstance: (instance: Instance) => void; success: (param: string) => void;
  fail: (result: Failure) => void; onError: () => void;
}
declare global {
  interface Window {
    initAliyunCaptcha?: (options: Options) => void | Promise<void>;
    AliyunCaptchaConfig?: {region: string; prefix: string};
  }
}
const SDK = "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";
let loading: Promise<void> | null = null;
let running = false;
function loadSdk() {
  if (window.initAliyunCaptcha) return Promise.resolve();
  if (!loading) loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SDK; script.async = true;
    const timeout = setTimeout(() => { script.remove(); reject(Error("ZCode verification could not load.")); }, 10000);
    script.onload = () => { clearTimeout(timeout); resolve(); };
    script.onerror = () => { clearTimeout(timeout); script.remove(); reject(Error("ZCode verification could not load.")); };
    document.head.appendChild(script);
  }).catch(error => { loading = null; throw error; });
  return loading;
}
/** One fresh verification per claim. Interactive challenges fall back to the official app. */
export async function verifyZcode(config: CaptchaConfig): Promise<string> {
  if (running) throw Error("ZCode verification is already in progress.");
  running = true;
  let container: HTMLDivElement | undefined, instance: Instance | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined, trigger: ReturnType<typeof setTimeout> | undefined;
  try {
    window.AliyunCaptchaConfig = {region: config.region, prefix: config.prefix};
    await loadSdk();
    if (!window.initAliyunCaptcha) throw Error("ZCode verification is unavailable.");
    container = document.createElement("div");
    const id = "quotapeek-zcode-" + Math.random().toString(36).slice(2);
    const mount = document.createElement("div"); mount.id = id;
    const button = document.createElement("button"); button.id = id + "-trigger"; button.hidden = true;
    container.append(mount, button); document.body.appendChild(container);
    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      const fail = () => { if (!settled) { settled = true; reject(Error("Complete verification and claim in the official ZCode app.")); } };
      const pass = (param: string) => {
        if (!settled && typeof param === "string" && param.length >= 16 && param.length <= 8192) { settled = true; resolve(param); }
        else if (!settled) fail();
      };
      timer = setTimeout(fail, 40000);
      try {
        const initialization = window.initAliyunCaptcha!({
          SceneId: config.sceneId, mode: "popup", language: "cn", showErrorTip: false,
          element: "#" + id, button: "#" + button.id,
          getInstance(value) {
            if (settled) { value.destroy?.(); return; }
            instance = value;
            if (!value.startTracelessVerification) { fail(); return; }
            trigger = setTimeout(() => { if (!settled) try { value.startTracelessVerification!(); } catch { fail(); } }, 2200);
          },
          success: pass,
          fail(result) {
            const code = result?.verifyCode ?? result?.VerifyCode;
            const terminalPass = result?.success === true && result?.verifyResult === true || code === "T006";
            const param = result?.captchaVerifyParam ?? result?.CaptchaVerifyParam;
            if (terminalPass) { if (param) pass(param); return; }
            fail();
          },
          onError: fail,
        });
        initialization?.catch(fail);
      } catch { fail(); }
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (trigger) clearTimeout(trigger);
    try { instance?.destroy?.(); } catch { /* SDK cleanup must not turn a success into a retry. */ }
    container?.remove(); running = false;
  }
}

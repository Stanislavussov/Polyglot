// A light tap on the phone as each piece of an answer lands, like a chat app streaming its reply.

// Pieces landing closer than this blur into a buzz; one tick for them reads better.
const MIN_GAP_MS = 120;

export function shouldTick(now: number, last: number | null): boolean {
  return last === null || now - last >= MIN_GAP_MS;
}

let lastTick: number | null = null;
let iosSwitch: HTMLLabelElement | null = null;

// iOS has no Vibration API in any browser (all of them are WebKit underneath), but toggling a native switch
// (`<input type="checkbox" switch>`, iOS 17.4+) plays the system's haptic tick — the only way a page reaches the Taptic Engine.
function iosTick(): void {
  if (!iosSwitch) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.id = "haptic-switch";
    iosSwitch = document.createElement("label");
    iosSwitch.htmlFor = input.id;
    iosSwitch.setAttribute("aria-hidden", "true");
    iosSwitch.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden";
    iosSwitch.append(input);
    document.body.append(iosSwitch);
  }
  iosSwitch.click();
}

export function hapticTick(): void {
  const now = performance.now();
  if (!shouldTick(now, lastTick)) return;
  lastTick = now;
  // Chrome, Firefox, Samsung Internet, Opera and Edge on Android vibrate; everything without the API gets the switch,
  // which is silent where there is no Taptic Engine.
  if (typeof navigator.vibrate === "function") navigator.vibrate(10);
  else iosTick();
}

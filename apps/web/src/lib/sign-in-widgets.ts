const TELEGRAM_SRC = "https://telegram.org/js/telegram-widget.js?22";
const GOOGLE_SRC = "https://accounts.google.com/gsi/client";

const loaded = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  const pending =
    loaded.get(src) ??
    new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.async = true;
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`${src} failed to load`));
      document.head.appendChild(script);
    });
  loaded.set(src, pending);
  return pending;
}

export const loadTelegramWidget = () => loadScript(TELEGRAM_SRC);

// Telegram.Login.auth instead of the embedded widget: the widget runs its
// data-onauth attribute through eval, which our CSP (no 'unsafe-eval') blocks.
export function openTelegramLogin(botId: number, onUser: (user: TelegramLoginUser) => void): boolean {
  if (!window.Telegram) return false;
  window.Telegram.Login.auth({ bot_id: botId, request_access: "write" }, (user) => {
    if (user) onUser(user);
  });
  return true;
}

/** Google draws its own button (its branding rules); we only pick the container and width. */
export async function renderGoogleButton(
  parent: HTMLElement,
  clientId: string,
  lang: string,
  onCredential: (credential: string) => void,
): Promise<void> {
  await loadScript(GOOGLE_SRC);
  const google = window.google;
  if (!google) throw new Error("google identity services missing");
  google.accounts.id.initialize({ client_id: clientId, callback: (response) => onCredential(response.credential) });
  google.accounts.id.renderButton(parent, {
    theme: "outline",
    size: "large",
    text: "continue_with",
    width: Math.min(parent.clientWidth || 320, 400),
    locale: lang,
  });
}

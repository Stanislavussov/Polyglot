/// <reference types="astro/client" />

interface TelegramLoginUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

interface GoogleIdentity {
  accounts: {
    id: {
      initialize(options: { client_id: string; callback: (response: { credential: string }) => void }): void;
      renderButton(
        parent: HTMLElement,
        options: {
          theme?: "outline" | "filled_blue";
          size?: "large";
          width?: number;
          text?: "signin_with" | "continue_with";
          locale?: string;
        },
      ): void;
    };
  };
}

interface Window {
  google?: GoogleIdentity;
  Telegram?: {
    Login: {
      auth(
        options: { bot_id: number; request_access?: "write" },
        callback: (user: TelegramLoginUser | false) => void,
      ): void;
    };
  };
}

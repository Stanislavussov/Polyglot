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

interface Window {
  Telegram?: {
    Login: {
      auth(
        options: { bot_id: number; request_access?: "write" },
        callback: (user: TelegramLoginUser | false) => void,
      ): void;
    };
  };
}

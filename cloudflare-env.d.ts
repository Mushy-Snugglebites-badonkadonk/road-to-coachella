declare namespace Cloudflare {
  interface Env {
    ASSETS: Fetcher;
    DB: D1Database;
    OWNER_EMAIL?: string;
    OWNER_DISPLAY_NAME?: string;
    INVITE_CODE_SECRET?: string;
    TRACKER_TOTAL_CENTS?: string;
    TRACKER_INSTALLMENT_CENTS?: string;
    TRACKER_ANCHOR_DATE?: string;
    SITE_URL?: string;
    EASTER_EGG_ENABLED?: string;
  }
}

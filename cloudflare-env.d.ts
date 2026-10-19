declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    AUTH_SECRET?: string;
    SEED_TOKEN?: string;
    ADMIN_PASSWORD?: string;
    STUDENT_PASSWORD?: string;
  }
}

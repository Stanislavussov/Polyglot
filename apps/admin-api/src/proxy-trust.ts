// One hop: the host nginx, which appends the peer it saw to X-Forwarded-For. Only
// that rightmost entry is real — `trustProxy: true` read the leftmost, which the
// client writes itself, so a forged header gave every login attempt a fresh
// rate-limit bucket and put a made-up IP in the failed-login log.
export const TRUSTED_PROXY_HOPS = 1;

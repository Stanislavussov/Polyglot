// One hop: the host nginx, which appends the peer it saw to X-Forwarded-For. Only
// that rightmost entry is real — `trustProxy: true` read the leftmost, which the
// client writes itself, so a forged header gave every login attempt a fresh
// rate-limit bucket and put a made-up IP in the failed-login log.
// A function, not the hop count `1`: fastify 5.12 reads a numeric trustProxy as
// "trust nobody", which would key every login on nginx's own address. Trusting
// the immediate peer blindly is safe only because compose binds the port to
// 127.0.0.1: the only peers are nginx and, on the compose network, the panel
// server, which passes on the header nginx gave it.
export function trustNginxHop(_address: string, hop: number): boolean {
  return hop === 0;
}

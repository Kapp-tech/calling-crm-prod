/**
 * The caller's IP, as best the app can tell.
 *
 * WHY THE *LAST* ENTRY, NOT THE FIRST — this is the subtle bit.
 *
 * `x-forwarded-for` is a chain that each hop appends to. The usual advice is
 * "take the leftmost, that is the original client", and that is right when you
 * are behind proxies you do not control. Here it is wrong and unsafe:
 *
 *   nginx sets  X-Forwarded-For  $proxy_add_x_forwarded_for
 *
 * which means "whatever the client sent, plus the address nginx actually saw".
 * A client that sends its own `X-Forwarded-For: 10.0.0.1` ends up with
 * `10.0.0.1, <their real IP>` — so the LEFTMOST is attacker-controlled and the
 * RIGHTMOST is the one our own nginx observed. With exactly one proxy hop
 * (nginx → the app on localhost:3000, which is this deployment), the last entry
 * is both correct and impossible for the client to forge.
 *
 * `x-real-ip` is preferred when present because nginx sets it from
 * `$remote_addr`, overwriting anything the client sent. It is NOT set on this
 * deployment today — the site config does not `include proxy_params` — but
 * preferring it means adding that line later silently improves things instead
 * of changing behaviour unexpectedly.
 *
 * If a CDN or load balancer is ever put in front of nginx, this needs
 * revisiting: the last entry would then be nginx's view of that balancer, and
 * the client would be one further left.
 */
export function clientIpFrom(headers: Headers): string | null {
  const real = headers.get('x-real-ip')?.trim();
  if (real) return normalise(real);

  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded.split(',').map((h) => h.trim()).filter(Boolean);
    const last = hops[hops.length - 1];
    if (last) return normalise(last);
  }
  return null;
}

/**
 * IPv4-mapped IPv6 (`::ffff:10.0.0.4`) reads better as the plain IPv4, and
 * loopback is named rather than shown as `::1` — on a dev machine the app talks
 * to itself, and an operator reading "::1" in the attendance log learns nothing.
 */
function normalise(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  const plain = mapped ? mapped[1] : ip;
  return plain === '::1' || plain === '127.0.0.1' ? 'localhost' : plain;
}

// LAN address discovery. Used for the QR link and for regenerating the TLS
// certificate's subjectAltName list when the machine changes networks.

import os from "node:os";

const SKIP_IFACE = /^(lo|docker|br-|veth|virbr|podman|tailscale|zt|wg|tun|tap)/;

// Every IPv4 address a phone on the same home network could reach, most
// likely first: the default-route interface wins, then wired, then wireless.
export function lanAddresses() {
  const candidates = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (SKIP_IFACE.test(name)) continue;
    for (const addr of addrs || []) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      candidates.push({ name, address: addr.address, score: scoreIface(name) });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
  return candidates;
}

function scoreIface(name) {
  if (/^(en|eth)/.test(name)) return 100;
  if (/^wl/.test(name)) return 90;
  if (/^enp|^eno|^ens/.test(name)) return 95;
  return 10;
}

export function primaryAddress() {
  return lanAddresses()[0]?.address || "127.0.0.1";
}

export function hostname() {
  return os.hostname().replace(/\.local$/i, "");
}

export function urlFor(config, token) {
  const host = primaryAddress();
  const query = token ? `?k=${encodeURIComponent(token)}` : "";
  return `https://${host}:${config.port}/${query}`;
}

// The address the QR code should carry: the Cloudflare tunnel when one is up
// and the user has not pinned LAN, otherwise the direct home-network URL.
export function publicUrl(config, token, tunnelUrl) {
  const query = token ? `?k=${encodeURIComponent(token)}` : "";
  const preferTunnel = (config.qrTarget || "tunnel") !== "lan";
  if (preferTunnel && tunnelUrl) return `${tunnelUrl}/${query}`;
  return urlFor(config, token);
}

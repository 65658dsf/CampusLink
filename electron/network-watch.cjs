'use strict';

// Watches the set of active external IPv4 addresses so joining campus Wi-Fi,
// switching networks, or plugging in a cable triggers a read-only status
// check within seconds instead of waiting for the next guard interval.
// Addresses only ever live in memory here; nothing is persisted or reported.

const os = require('node:os');

function interfaceSignature(interfaces = os.networkInterfaces()) {
  const parts = [];
  for (const [name, addresses] of Object.entries(interfaces || {})) {
    for (const address of addresses || []) {
      if (address.internal) continue;
      // Node 18+ reports family as a string; older runtimes used the number 4.
      if (address.family !== 'IPv4' && address.family !== 4) continue;
      parts.push(`${name}:${address.address}`);
    }
  }
  parts.sort();
  return parts.join('|');
}

function createNetworkWatcher({ onChange, intervalMs = 3000, signature = interfaceSignature, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (typeof onChange !== 'function') throw new TypeError('onChange 必须为函数');
  let timer = null;
  let stopped = true;
  let current = signature();
  const compare = () => {
    const next = signature();
    if (next === current) return;
    current = next;
    try {
      const result = onChange();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch { /* A failing consumer must not stop the watcher. */ }
  };
  const schedule = () => {
    if (stopped || timer !== null) return;
    timer = setTimer(() => {
      timer = null;
      if (stopped) return;
      compare();
      schedule();
    }, intervalMs);
    timer?.unref?.();
  };
  return {
    start() { stopped = false; current = signature(); schedule(); },
    stop() { stopped = true; if (timer !== null) { clearTimer(timer); timer = null; } },
    check: compare,
    get active() { return !stopped; },
  };
}

module.exports = { createNetworkWatcher, interfaceSignature };

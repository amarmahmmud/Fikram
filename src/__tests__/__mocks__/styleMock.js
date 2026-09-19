const proxy = new Proxy({}, {
  get: (target, key) => {
    if (key === "__esModule") return true;
    if (key === "default") return proxy;
    return String(key);
  },
});

module.exports = proxy;

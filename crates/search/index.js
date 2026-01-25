/**
 * @cct/search - NAPI-RS entry point
 *
 * This file loads the native Rust module compiled via NAPI-RS.
 */

const { platform, arch } = process;

let nativeBinding = null;
let loadError = null;

// Determine the correct binary to load based on platform/arch
function getBindingPath() {
  const bindings = {
    'darwin-arm64': './cct-search.darwin-arm64.node',
    'darwin-x64': './cct-search.darwin-x64.node',
    'linux-x64-gnu': './cct-search.linux-x64-gnu.node',
    'linux-x64-musl': './cct-search.linux-x64-musl.node',
    'linux-arm64-gnu': './cct-search.linux-arm64-gnu.node',
    'linux-arm64-musl': './cct-search.linux-arm64-musl.node',
    'win32-x64-msvc': './cct-search.win32-x64-msvc.node',
    'win32-arm64-msvc': './cct-search.win32-arm64-msvc.node',
  };

  // Try platform-arch combination
  let key = `${platform}-${arch}`;

  if (platform === 'linux') {
    // Detect musl vs gnu
    const isMusl = require('fs').existsSync('/etc/alpine-release') ||
      (require('child_process').execSync('ldd --version 2>&1 || true', { encoding: 'utf8' }).includes('musl'));
    key = `${platform}-${arch}-${isMusl ? 'musl' : 'gnu'}`;
  } else if (platform === 'win32') {
    key = `${platform}-${arch}-msvc`;
  }

  return bindings[key];
}

try {
  const bindingPath = getBindingPath();
  if (bindingPath) {
    nativeBinding = require(bindingPath);
  } else {
    loadError = new Error(`Unsupported platform: ${platform}-${arch}`);
  }
} catch (err) {
  loadError = err;
}

// Export with fallback for dev environments
if (nativeBinding) {
  module.exports = nativeBinding;
} else {
  // Provide stub exports that throw helpful errors
  const notAvailable = (name) => () => {
    throw new Error(
      `@cct/search native module not available: ${loadError?.message || 'unknown error'}\n` +
      `Build the Rust crate with: cd crates/search && cargo build --release`
    );
  };

  module.exports = {
    SearchIndex: class SearchIndex {
      constructor() {
        throw notAvailable('SearchIndex')();
      }
    },
    SearchResult: class SearchResult {},
    SessionMetadata: class SessionMetadata {},
    IndexStats: class IndexStats {},
  };
}

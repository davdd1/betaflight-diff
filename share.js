/*
 * Share state in the URL hash: {a, b} -> JSON -> deflate-raw -> base64url.
 * Everything stays in the browser; a hash is never sent to a server.
 * Falls back to plain percent-encoding where CompressionStream is missing.
 */
(function (root) {
  'use strict';

  function toB64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64(str) {
    var b = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
    return out;
  }
  async function pipe(bytes, stream) {
    var buf = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
    return new Uint8Array(buf);
  }

  async function encode(a, b) {
    var json = JSON.stringify([a || '', b || '']);
    var raw = new TextEncoder().encode(json);
    if (typeof CompressionStream === 'undefined') return 'p=' + encodeURIComponent(json);
    return 'z=' + toB64(await pipe(raw, new CompressionStream('deflate-raw')));
  }

  // Returns {a, b} or null for anything that is not a valid share hash.
  async function decode(hash) {
    try {
      var h = String(hash || '').replace(/^#/, '');
      var arr;
      if (h.indexOf('z=') === 0) {
        var bytes = await pipe(fromB64(h.slice(2)), new DecompressionStream('deflate-raw'));
        arr = JSON.parse(new TextDecoder().decode(bytes));
      } else if (h.indexOf('p=') === 0) {
        arr = JSON.parse(decodeURIComponent(h.slice(2)));
      } else return null;
      if (!Array.isArray(arr) || typeof arr[0] !== 'string' || typeof arr[1] !== 'string') return null;
      return { a: arr[0], b: arr[1] };
    } catch (e) { return null; }
  }

  var api = { encode: encode, decode: decode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BFShare = api;
})(typeof self !== 'undefined' ? self : this);

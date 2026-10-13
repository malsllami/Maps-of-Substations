/**
 * ===================================================
 * Crypto.gs — WebAuthn cryptographic primitives
 * ===================================================
 * Pure-JS implementation, no external libraries. Verified against
 * Node's native crypto module before being ported here (registration +
 * assertion round trip, tamper rejection, clone/replay rejection, all passing).
 *
 * Apps Script's V8 runtime supports the BigInt() function, which is what
 * makes a from-scratch, auditable EC implementation practical instead of
 * vendoring a third-party bignum/elliptic-curve library. It does NOT
 * support the `123n` literal suffix syntax (ParseError: Unexpected token
 * ILLEGAL) -- every BigInt value in this file is built via BigInt(...).
 *
 * SHA-256 is NOT implemented here -- Utilities.computeDigest is native
 * and used directly wherever a digest is needed.
 */

// Shared BigInt constants (defined once near the top -- Apps Script
// doesn't support the `0n` literal suffix, so these avoid repeating
// BigInt(0) etc. throughout the file).
var BI_0 = BigInt(0);
var BI_1 = BigInt(1);
var BI_2 = BigInt(2);
var BI_3 = BigInt(3);
var BI_8 = BigInt(8);

// ===================================================
// base64url helpers
// ===================================================
// Apps Script's *WebSafe variants already use '-' and '_' instead of '+'
// and '/'. The browser's base64url (no padding) and these differ only in
// padding, which we normalize away on both ends.

function b64urlDecodeToBytes(str) {
  // Accept either padded or unpadded base64url from the browser.
  var s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4 !== 0) s += '=';
  var raw = Utilities.base64Decode(s);
  return toUnsignedByteArray(raw);
}

function bytesToB64url(bytes) {
  // bytes: plain JS array or Apps Script byte array
  var encoded = Utilities.base64EncodeWebSafe(bytes);
  return encoded.replace(/=+$/, '');
}

function toUnsignedByteArray(arr) {
  // Apps Script byte arrays can come back as signed (-128..127); normalize to 0..255
  var out = new Array(arr.length);
  for (var i = 0; i < arr.length; i++) out[i] = arr[i] & 0xff;
  return out;
}

// ===================================================
// SHA-256 wrapper (native)
// ===================================================
function sha256(byteArrayOrBytes) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, byteArrayOrBytes);
  return toUnsignedByteArray(digest);
}

function concatBytes() {
  var total = [];
  for (var i = 0; i < arguments.length; i++) {
    var part = arguments[i];
    for (var j = 0; j < part.length; j++) total.push(part[j]);
  }
  return total;
}

// ===================================================
// UTF-8 byte decoder
// (replaces the deprecated escape()/unescape() trick;
//  validated against Node's native UTF-8 handling -- ASCII, Arabic,
//  Japanese, and emoji/surrogate-pair cases all round-trip correctly)
// ===================================================
function utf8BytesToString(bytes) {
  var result = '';
  var i = 0;
  while (i < bytes.length) {
    var b1 = bytes[i] & 0xff;
    if (b1 < 0x80) {
      result += String.fromCharCode(b1);
      i += 1;
    } else if ((b1 & 0xe0) === 0xc0) {
      var b2 = bytes[i + 1] & 0xff;
      result += String.fromCharCode(((b1 & 0x1f) << 6) | (b2 & 0x3f));
      i += 2;
    } else if ((b1 & 0xf0) === 0xe0) {
      var b2b = bytes[i + 1] & 0xff, b3 = bytes[i + 2] & 0xff;
      result += String.fromCharCode(((b1 & 0x0f) << 12) | ((b2b & 0x3f) << 6) | (b3 & 0x3f));
      i += 3;
    } else if ((b1 & 0xf8) === 0xf0) {
      var b2c = bytes[i + 1] & 0xff, b3c = bytes[i + 2] & 0xff, b4 = bytes[i + 3] & 0xff;
      var cp = ((b1 & 0x07) << 18) | ((b2c & 0x3f) << 12) | ((b3c & 0x3f) << 6) | (b4 & 0x3f);
      cp -= 0x10000;
      result += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      i += 4;
    } else {
      i += 1; // invalid byte, skip
    }
  }
  return result;
}

// ===================================================
// Minimal CBOR decoder
// (validated against the `cbor` reference library: COSE_Key maps,
//  attestationObject maps, extended-length encodings, negative ints)
// ===================================================
function decodeCbor(bytes, offset) {
  offset = offset || 0;
  var initial = bytes[offset];
  var majorType = initial >> 5;
  var infoBits = initial & 0x1f;
  offset++;

  function readLength(info) {
    if (info < 24) return { len: info, offset: offset };
    if (info === 24) { var len1 = bytes[offset]; offset += 1; return { len: len1, offset: offset }; }
    if (info === 25) { var len2 = (bytes[offset] << 8) | bytes[offset + 1]; offset += 2; return { len: len2, offset: offset }; }
    if (info === 26) {
      var len3 = 0;
      for (var i = 0; i < 4; i++) len3 = (len3 << 8) | bytes[offset + i];
      offset += 4;
      return { len: len3 >>> 0, offset: offset };
    }
    throw new Error('CBOR length encoding not supported: info=' + info);
  }

  switch (majorType) {
    case 0: { // unsigned int
      var r0 = readLength(infoBits); offset = r0.offset;
      return { value: r0.len, nextOffset: offset };
    }
    case 1: { // negative int
      var r1 = readLength(infoBits); offset = r1.offset;
      return { value: -1 - r1.len, nextOffset: offset };
    }
    case 2: { // byte string
      var r2 = readLength(infoBits); offset = r2.offset;
      var bs = bytes.slice(offset, offset + r2.len);
      offset += r2.len;
      return { value: bs, nextOffset: offset };
    }
    case 3: { // text string
      var r3 = readLength(infoBits); offset = r3.offset;
      var slice = bytes.slice(offset, offset + r3.len);
      offset += r3.len;
      return { value: utf8BytesToString(slice), nextOffset: offset };
    }
    case 4: { // array
      var r4 = readLength(infoBits); offset = r4.offset;
      var arr = [];
      for (var a = 0; a < r4.len; a++) {
        var item = decodeCbor(bytes, offset);
        arr.push(item.value);
        offset = item.nextOffset;
      }
      return { value: arr, nextOffset: offset };
    }
    case 5: { // map
      var r5 = readLength(infoBits); offset = r5.offset;
      var map = {};
      for (var m = 0; m < r5.len; m++) {
        var keyItem = decodeCbor(bytes, offset); offset = keyItem.nextOffset;
        var valItem = decodeCbor(bytes, offset); offset = valItem.nextOffset;
        map[keyItem.value] = valItem.value;
      }
      return { value: map, nextOffset: offset };
    }
    case 7: {
      if (infoBits === 20) return { value: false, nextOffset: offset };
      if (infoBits === 21) return { value: true, nextOffset: offset };
      if (infoBits === 22) return { value: null, nextOffset: offset };
      throw new Error('CBOR simple type not supported: ' + infoBits);
    }
    default:
      throw new Error('CBOR major type not supported: ' + majorType);
  }
}

// ===================================================
// authenticatorData binary layout parser
// rpIdHash(32) | flags(1) | signCount(4, BE) |
//   [if AT flag: aaguid(16) | credIdLen(2,BE) | credId(N) | COSE_Key(CBOR)]
// ===================================================
function parseAuthData(bytes) {
  var offset = 0;
  var rpIdHash = bytes.slice(offset, offset + 32); offset += 32;
  var flags = bytes[offset]; offset += 1;
  var signCount = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
  offset += 4;

  var AT = !!(flags & 0x40);
  var UP = !!(flags & 0x01);
  var UV = !!(flags & 0x04);

  var result = { rpIdHash: rpIdHash, flags: flags, signCount: signCount, userPresent: UP, userVerified: UV };

  if (AT) {
    var aaguid = bytes.slice(offset, offset + 16); offset += 16;
    var credIdLen = (bytes[offset] << 8) | bytes[offset + 1]; offset += 2;
    var credentialId = bytes.slice(offset, offset + credIdLen); offset += credIdLen;
    var coseItem = decodeCbor(bytes, offset);

    result.aaguid = aaguid;
    result.credentialId = credentialId;
    result.coseKey = coseItem.value;
  }

  return result;
}

// ===================================================
// DER signature parser: SEQUENCE { INTEGER r, INTEGER s }
// ===================================================
function derSignatureToRS(der) {
  var offset = 0;
  if (der[offset++] !== 0x30) throw new Error('Invalid DER signature');
  var len = der[offset++];
  if (len & 0x80) { var n = len & 0x7f; len = 0; for (var i = 0; i < n; i++) len = (len << 8) | der[offset++]; }

  function readInt() {
    if (der[offset++] !== 0x02) throw new Error('Invalid DER integer tag');
    var l = der[offset++];
    if (l & 0x80) { var ln = l & 0x7f; l = 0; for (var i2 = 0; i2 < ln; i2++) l = (l << 8) | der[offset++]; }
    var val = BI_0;
    for (var j = 0; j < l; j++) val = (val << BI_8) | BigInt(der[offset++]);
    return val;
  }

  var r = readInt();
  var s = readInt();
  return { r: r, s: s };
}

// ===================================================
// P-256 (secp256r1) point math + ECDSA verify
// Validated against Node's native crypto: valid sigs accept (20/20 random
// trials), tampered hash/signature/wrong-key all correctly reject.
// ===================================================
var P256_P = BigInt('0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff');
var P256_A = BigInt(-3);
var P256_B = BigInt('0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b');
var P256_N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
var P256_Gx = BigInt('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296');
var P256_Gy = BigInt('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5');

function p256mod(a, m) { var r = a % m; return r >= BI_0 ? r : r + m; }

function p256ModInverse(a, m) {
  a = p256mod(a, m);
  var old_r = a, r = m;
  var old_s = BI_1, s = BI_0;
  while (r !== BI_0) {
    var q = old_r / r;
    var tmp_r = old_r - q * r; old_r = r; r = tmp_r;
    var tmp_s = old_s - q * s; old_s = s; s = tmp_s;
  }
  if (old_r !== BI_1) throw new Error('no modular inverse');
  return p256mod(old_s, m);
}

var P256_INF = null;

function p256Double(pt) {
  if (pt === P256_INF) return P256_INF;
  if (pt.y === BI_0) return P256_INF;
  var lam = p256mod((BI_3 * pt.x * pt.x + P256_A) * p256ModInverse(BI_2 * pt.y, P256_P), P256_P);
  var x3 = p256mod(lam * lam - BI_2 * pt.x, P256_P);
  var y3 = p256mod(lam * (pt.x - x3) - pt.y, P256_P);
  return { x: x3, y: y3 };
}

function p256Add(p1, p2) {
  if (p1 === P256_INF) return p2;
  if (p2 === P256_INF) return p1;
  if (p1.x === p2.x) {
    if (p256mod(p1.y + p2.y, P256_P) === BI_0) return P256_INF;
    return p256Double(p1);
  }
  var lam = p256mod((p2.y - p1.y) * p256ModInverse(p2.x - p1.x, P256_P), P256_P);
  var x3 = p256mod(lam * lam - p1.x - p2.x, P256_P);
  var y3 = p256mod(lam * (p1.x - x3) - p1.y, P256_P);
  return { x: x3, y: y3 };
}

function p256ScalarMult(k, pt) {
  var result = P256_INF;
  var addend = pt;
  k = p256mod(k, P256_N);
  while (k > BI_0) {
    if (k & BI_1) result = p256Add(result, addend);
    addend = p256Double(addend);
    k >>= BI_1;
  }
  return result;
}

function p256IsOnCurve(pt) {
  if (pt === P256_INF) return false;
  var lhs = p256mod(pt.y * pt.y, P256_P);
  var rhs = p256mod(pt.x * pt.x * pt.x + P256_A * pt.x + P256_B, P256_P);
  return lhs === rhs;
}

/**
 * hashBytes: array of unsigned bytes (SHA-256 digest of the signed data)
 * r, s: BigInt signature components
 * Q: { x: BigInt, y: BigInt } public key point
 */
function ecdsaVerifyP256(hashBytes, r, s, Q) {
  if (r <= BI_0 || r >= P256_N || s <= BI_0 || s >= P256_N) return false;
  if (!p256IsOnCurve(Q)) return false;

  var z = BI_0;
  for (var i = 0; i < hashBytes.length; i++) z = (z << BI_8) | BigInt(hashBytes[i]);
  z = z % P256_N;

  var w = p256ModInverse(s, P256_N);
  var u1 = p256mod(z * w, P256_N);
  var u2 = p256mod(r * w, P256_N);

  var point = p256Add(p256ScalarMult(u1, { x: P256_Gx, y: P256_Gy }), p256ScalarMult(u2, Q));
  if (point === P256_INF) return false;
  return p256mod(point.x, P256_N) === r;
}

function bytesToBigIntUnsigned(bytes) {
  var v = BI_0;
  for (var i = 0; i < bytes.length; i++) v = (v << BI_8) | BigInt(bytes[i] & 0xff);
  return v;
}
// CloudFront Function (viewer request) — belépés-kapu a statikus tartalom előtt.
//
// Minden nem-/api/* kérésnél ellenőrzi a munkamenet-sütit:
//     pz_session = <lejárat epoch>~<e-mail>~<HMAC-SHA256 hex(<lejárat>~<e-mail>)>
// Érvényes, lejáratlan süti nélkül a felület egyetlen fájlja sem töltődik be:
// a kérés a /api/auth/login címre irányul (Cognito → Google belépés).
// A sütit a Lambda állítja ki a sikeres belépés után (app/auth.py).
//
// A Terraform templatefile() tölti ki a titkot; JS template literal (backtick)
// ezért szándékosan nincs a fájlban.

var crypto = require('crypto');

var SECRET = '${session_secret}';
var COOKIE = 'pz_session';
var LOGIN_PATH = '/api/auth/login';

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function validSession(value, nowMs) {
  if (!value) return false;
  var sep = value.lastIndexOf('~');
  if (sep <= 0) return false;
  var data = value.substring(0, sep);
  var sig = value.substring(sep + 1);
  var exp = parseInt(data.split('~')[0], 10);
  if (!(exp * 1000 > nowMs)) return false;
  var expected = crypto.createHmac('sha256', SECRET).update(data).digest('hex');
  return safeEqual(expected, sig);
}

function handler(event) {
  var request = event.request;
  var cookie = request.cookies[COOKIE];
  if (cookie && validSession(cookie.value, Date.now())) {
    return request;
  }
  return {
    statusCode: 302,
    statusDescription: 'Found',
    headers: {
      location: { value: LOGIN_PATH + '?next=' + encodeURIComponent(request.uri) },
      'cache-control': { value: 'no-store' }
    }
  };
}

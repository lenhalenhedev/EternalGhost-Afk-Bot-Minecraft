'use strict';

/**
 * AuthMe / LoginSecurity message pattern matching.
 *
 * Pure data + matcher helpers (no side effects) so they can be unit tested in
 * isolation. Keeping every regex here — instead of inline in the connection
 * handler — means the multilingual coverage can be reviewed and extended in one
 * place (single responsibility).
 */

// Prompts that tell the client it must authenticate.
const AUTH_PROMPTS = [
  // Vietnamese (confirmed server language)
  /vui l\u00f2ng \u0111\u0103ng k\u00fd/i, /\u0111\u0103ng k\u00fd v\u00e0o m\u00e1y ch\u1ee7/i, /\/register/i,
  /vui l\u00f2ng \u0111\u0103ng nh\u1eadp/i, /\u0111\u0103ng nh\u1eadp v\u00e0o m\u00e1y ch\u1ee7/i, /\/login/i,
  /ch\u01b0a \u0111\u0103ng nh\u1eadp/i, /ch\u01b0a \u0111\u0103ng k\u00fd/i, /b\u1ea1n ch\u01b0a/i,
  /c\u00e1ch d\u00f9ng.*register/i, /c\u00e1ch d\u00f9ng.*login/i,
  // English
  /you need to register/i, /please register/i,
  /you need to log ?in/i, /please log ?in/i,
  /not logged in/i, /please authenticate/i, /you must (log ?in|authenticate)/i,
  /use \/login/i, /use \/register/i, /type \/login/i, /type \/register/i,
  /login to (play|continue|proceed)/i,
  /account (not found|does not exist|unregistered)/i,
  // Dutch
  /inloggen/i, /aanmelden/i, /registreer/i,
  // Russian / East EU
  /\u043f\u043e\u0436\u0430\u043b\u0443\u0439\u0441\u0442\u0430/i, /\u0432\u043e\u0439\u0434\u0438\u0442\u0435/i, /\u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u0443\u0439\u0442\u0435\u0441\u044c/i, /\u0430\u0432\u0442\u043e\u0440\u0438\u0437\u0443/i,
  // German
  /anmeld/i, /einloggen/i, /registrier/i,
];

// Success signals from AuthMe / LoginSecurity.
const AUTH_SUCCESS = [
  // Vietnamese (confirmed server language – from messages.yml)
  /\u0111\u0103ng k\u00fd th\u00e0nh c\u00f4ng/i,
  /\u0111\u0103ng nh\u1eadp th\u00e0nh c\u00f4ng/i,
  /th\u00e0nh c\u00f4ng/i,
  /\u0111\u00e3 \u0111\u0103ng (k\u00fd|nh\u1eadp)/i,
  /x\u00e1c th\u1ef1c th\u00e0nh c\u00f4ng/i,
  /ch\u00e0o m\u1eebng/i,
  // English
  /you (are|have been) (now |successfully |)logged in/i,
  /successfully logged in/i, /login successful/i,
  /logged in successfully/i, /welcome back/i,
  /you are now authenticated/i, /authentication successful/i,
  /you (may|can) now play/i,
  /logged in!/i, /login accepted/i, /you are logged in/i,
  // Dutch
  /je bent (nu |succesvol |)ingelogd/i, /inloggen geslaagd/i, /welkom terug/i,
  // Russian
  /\u0434\u043e\u0431\u0440\u043e \u043f\u043e\u0436\u0430\u043b\u043e\u0432\u0430\u0442\u044c/i, /\u0432\u044b (\u0443\u0441\u043f\u0435\u0448\u043d\u043e |)\u0430\u0432\u0442\u043e\u0440\u0438\u0437\u043e\u0432\u0430\u043d\u044b/i, /\u0432\u044b \u0432\u043e\u0448\u043b\u0438/i,
  // German
  /erfolgreich (an|ein)gemeldet/i,
];

// Non-recoverable auth failures – abort instead of wasting retries.
const AUTH_HARD_FAIL =
  /wrong password|incorrect password|too many (attempts|tries)|banned|account (blocked|locked)/i;

// Account is in use elsewhere – back off and retry later.
const DUPLICATE_LOGIN = /already logged in|duplicate login|someone else/i;

const anyMatch = (patterns, msg) => patterns.some((re) => re.test(msg));

module.exports = {
  AUTH_PROMPTS,
  AUTH_SUCCESS,
  AUTH_HARD_FAIL,
  DUPLICATE_LOGIN,
  isAuthPrompt: (msg) => anyMatch(AUTH_PROMPTS, msg),
  isAuthSuccess: (msg) => anyMatch(AUTH_SUCCESS, msg),
  isAuthHardFail: (msg) => AUTH_HARD_FAIL.test(msg),
  isDuplicateLogin: (msg) => DUPLICATE_LOGIN.test(msg),
};

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;
const { parseChatInput: classifyChatInput } = require('../utils/chatInput');

function validateWebChatInput(input) {
  const text = String(input ?? '');
  if (!text || text.trim() === '')
    return { valid: false, reason: 'Message cannot be empty' };
  if (text.length > 200)
    return { valid: false, reason: 'Message exceeds 200 characters' };
  if (CONTROL_CHARS_RE.test(text))
    return {
      valid: false,
      reason: 'Message contains invalid control characters',
    };
  return { valid: true, value: text };
}

function parseChatInput(input) {
  const { kind, text } = classifyChatInput(input);
  return { kind, text };
}

module.exports = { parseChatInput, validateWebChatInput };

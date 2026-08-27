'use strict';

/**
 * Classifies the exact user input without trimming it. A slash is a command
 * marker only when it is the first character; Minecraft still receives the
 * original message so command syntax is preserved.
 */
function parseChatInput(input) {
  const text = String(input ?? '');
  const isCommand = text.startsWith('/');
  return {
    kind: isCommand ? 'command' : 'chat',
    text,
    command: isCommand ? text.slice(1) : null,
  };
}

module.exports = { parseChatInput };

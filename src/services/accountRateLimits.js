'use strict';

const config = require('../config');
const {
  CooldownRateLimiter,
  SlidingWindowRateLimiter,
} = require('../utils/rateLimiter');

const chatLimiter = new CooldownRateLimiter(config.limits.chatCooldownMs);
const botCreateLimiter = new SlidingWindowRateLimiter(
  config.limits.botCreateLimit,
  config.limits.botCreateWindowMs
);

function consumeChat(userId, now = Date.now()) {
  return chatLimiter.consume(String(userId), now);
}

function consumeBotCreation(userId, now = Date.now()) {
  return botCreateLimiter.consume(String(userId), now);
}

module.exports = { consumeChat, consumeBotCreation };

'use strict';
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const COMMANDS = [
  { name: '/create-bot',   desc: 'Tạo bot mới. Cần: `host`, `port`, `username`, `version`. Tùy chọn: `password`, `auto-reconnect`.' },
  { name: '/delete-bot',   desc: 'Xóa bot (sẽ stop trước, yêu cầu xác nhận). Cần: `id`.' },
  { name: '/edit-bot',     desc: 'Chỉnh sửa config bot (yêu cầu stop trước). Cần: `id`. Tùy chọn: `host`, `port`, `version`, `password`, `auto-reconnect`.' },
  { name: '/list-bot',     desc: 'Danh sách tất cả bot (phân trang). ⭐ = bot đang chọn.' },
  { name: '/select-bot',   desc: 'Chọn bot để điều khiển mặc định. Cần: `id`.' },
  { name: '/status-bot',   desc: 'Trạng thái chi tiết: state, tọa độ, HP, food, ping, uptime. Tùy chọn: `id`.' },
  { name: '/start',        desc: 'Khởi động bot. Tùy chọn: `id`.' },
  { name: '/stop',         desc: 'Dừng bot. Tùy chọn: `id`, `force`. Force stop = bỏ qua queue.' },
  { name: '/restart',      desc: 'Khởi động lại bot. Tùy chọn: `id`.' },
  { name: '/chat',         desc: 'Gửi chat vào game. Cần: `message`. Cooldown 2.5s. Max 200 ký tự. Không gửi lệnh `/` trừ whitelist.' },
  { name: '/logs-bot',     desc: 'Xem log gần nhất. Tùy chọn: `id`, `lines` (max 50), `hours` (1-24h), `level`.' },
  { name: '/stats',        desc: 'System health: RAM, CPU uptime, số bot theo state.' },
  { name: '/help',         desc: 'Hiển thị trang trợ giúp này.' },
];

const STATE_GUIDE = [
  '`OFFLINE` ➜ Bot chưa kết nối / đã stop',
  '`CONNECTING` ➜ Đang kết nối TCP đến server',
  '`AUTHENTICATING` ➜ Đang đăng nhập AuthMe (/login /register)',
  '`PLAYING` ➜ Đã vào game, chưa vào AFK mode',
  '`AFK` ➜ Đang di chuyển ngẫu nhiên chống kick',
  '`COMBAT` ➜ Đang đánh mob',
  '`ERROR` ➜ Lỗi nghiêm trọng (login fail / reconnect hết giới hạn)',
  '`DISCONNECTED` ➜ Mất kết nối',
  '`RECONNECTING` ➜ Đang chờ kết nối lại (exponential backoff)',
].join('\n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Hướng dẫn sử dụng Discord Minecraft AFK Bot'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const cmdFields = COMMANDS.map(c => ({ name: c.name, value: c.desc, inline: false }));

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('🎮 Discord Minecraft AFK Bot — Hướng Dẫn')
      .setDescription(
        '**Quản lý nhiều bot Minecraft AFK qua Discord Slash Commands.**\n' +
        'Tất cả lệnh đều yêu cầu quyền Admin (cấu hình qua `ADMIN_USER_IDS` trong `.env`).\n\n' +
        '> 💡 Tip: Dùng `/select-bot <id>` một lần, sau đó các lệnh `/start`, `/stop`, `/chat`... sẽ tự dùng bot đó.\n'
      )
      .addFields(
        ...cmdFields,
        {
          name: '📋 State Machine',
          value: STATE_GUIDE,
          inline: false,
        },
        {
          name: '⚠️ Giới Hạn Hệ Thống',
          value: [
            `• Tối đa **50 bots** / instance Node.js (~100-200MB RAM/bot)`,
            `• Queue tối đa **100 task**/bot, timeout **10s**/task`,
            `• Auto-reconnect: **5 lần / 10 phút**, backoff 5s→30s→60s→90s→120s`,
            `• Login AuthMe: tối đa **5 lần**, fail → ERROR + Discord alert`,
            `• Chat cooldown: **2.5s** / user`,
          ].join('\n'),
          inline: false,
        }
      )
      .setFooter({ text: '❌ Lệnh không hợp lệ 👉 Dùng /help để xem' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

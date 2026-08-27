const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { issueToken } = require('../../web/auth/tokenService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('new-token')
    .setDescription('Issue a Web dashboard token to a Discord user')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('Discord user who will own the token')
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName('expired')
        .setDescription('Token lifetime in milliseconds')
        .setMinValue(1_000)
        .setMaxValue(Number.MAX_SAFE_INTEGER)
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = interaction.options.getUser('user');
    const ttlMs = interaction.options.getInteger('expired');
    const result = await issueToken(user.id, ttlMs);
    await interaction.editReply(
      [
        `Token created for Discord User ID: \`${user.id}\`.`,
        `Expires: <t:${Math.floor(new Date(result.metadata.expiresAt).getTime() / 1000)}:F>.`,
        '',
        'Copy this token now. It will not be shown again:',
        `\`${result.token}\``,
      ].join('\n')
    );
  },
};

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { issueTokenDays } = require('../../web/auth/tokenService');
const { MAX_TOKEN_TTL_DAYS } = require('../../web/auth/tokenValidation');

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
        .setDescription('Token lifetime in days')
        .setMinValue(1)
        .setMaxValue(MAX_TOKEN_TTL_DAYS)
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = interaction.options.getUser('user');
    const days = interaction.options.getInteger('expired');
    const result = await issueTokenDays(user.id, days);
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

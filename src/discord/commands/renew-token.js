const {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const {
  listTokenMetadata,
  renewToken,
} = require('../../web/auth/tokenService');
const { MAX_TOKEN_TTL_DAYS } = require('../../web/auth/tokenValidation');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('renew-token')
    .setDescription('Renew a Web dashboard token')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option
        .setName('user')
        .setDescription('Discord User ID with a token')
        .setAutocomplete(true)
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName('time')
        .setDescription('Additional token lifetime in days')
        .setMinValue(1)
        .setMaxValue(MAX_TOKEN_TTL_DAYS)
        .setRequired(true)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const tokens = await listTokenMetadata();
    await interaction.respond(
      tokens
        .filter((token) => token.userId.includes(focused))
        .slice(0, 25)
        .map((token) => ({
          name: `${token.userId} — expires ${token.expiresAt.slice(0, 10)}`,
          value: token.userId,
        }))
    );
  },

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const userId = interaction.options.getString('user', true);
    const time = interaction.options.getInteger('time', true);
    const result = await renewToken(userId, time);
    await interaction.editReply(
      [
        `Token renewed for Discord User ID: \`${userId}\`.`,
        `New expiry: <t:${Math.floor(new Date(result.metadata.expiresAt).getTime() / 1000)}:F>.`,
        '',
        'Copy this token now. It will not be shown again:',
        `\`${result.token}\``,
      ].join('\n')
    );
  },
};

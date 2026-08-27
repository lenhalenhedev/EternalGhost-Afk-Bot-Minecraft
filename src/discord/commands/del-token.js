const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const {
  listTokenMetadata,
  revokeToken,
} = require('../../web/auth/tokenService');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('del-token')
    .setDescription('Revoke a Web dashboard token')
    .addStringOption((option) =>
      option
        .setName('user')
        .setDescription('Discord User ID with an active token')
        .setAutocomplete(true)
        .setRequired(true)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const tokens = await listTokenMetadata();
    await interaction.respond(
      tokens
        .filter(
          (token) => token.status === 'active' && token.userId.includes(focused)
        )
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
    const revoked = await revokeToken(userId);
    await interaction.editReply(
      revoked
        ? `Token revoked for Discord User ID: \`${userId}\`.`
        : `No active token found for Discord User ID: \`${userId}\`.`
    );
  },
};

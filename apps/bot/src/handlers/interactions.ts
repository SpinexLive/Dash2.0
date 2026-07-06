import { Events, Interaction, MessageFlags } from 'discord.js';
import { prisma } from '@hll/db';
import { client } from '../client';
import { buildRosterMessage, loadRoster, loadRosterEmojiConfig } from './commands';

/**
 * Handles roster Confirm/Decline button presses. The clicking user updates
 * their own attendance confirmation; the embed is then refreshed and the DB
 * UPDATE fires the roster.updated NOTIFY trigger, which the API forwards to the
 * dashboard in real time.
 */
export function registerInteractionHandler() {
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (!interaction.isButton()) return;

    const [scope, rosterId, action] = interaction.customId.split(':');
    if (scope !== 'roster') return;

    const response = action === 'accept' ? 'accepted' : 'declined';

    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch (err) {
      console.error('[bot] roster interaction defer failed', err);
      return;
    }

    // Find the confirmation row belonging to the user who clicked.
    const slot = await prisma.rosterSlot.findFirst({
      where: { rosterId: BigInt(rosterId), discordId: interaction.user.id },
    });
    if (!slot) {
      await interaction.editReply('You are not assigned a spot in this roster.');
      return;
    }

    await prisma.rosterSlot.update({
      where: { id: slot.id },
      data: { response, respondedAt: new Date() },
    });

    // Refresh the posted embed to reflect the new confirmation state.
    try {
      const roster = await loadRoster(rosterId);
      if (roster) {
        await interaction.message.edit(await buildRosterMessage(roster, await loadRosterEmojiConfig()));
      }
    } catch (err) {
      console.error('[bot] roster embed refresh failed', err);
    }

    await interaction.editReply(`You **${response}** your spot.`);
  });
}

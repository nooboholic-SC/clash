const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    EmbedBuilder,
    Events
} = require('discord.js');

require('dotenv').config();

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const activeGames = new Map();

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

// -------------------------
// FAKE AI JUDGE
// -------------------------
function judgeBattle(a, b) {
    const reasons = [
        `${a} completely overwhelmed ${b} with unexpected power.`,
        `${b} stood no chance against the chaos of ${a}.`,
        `${a} used pure creativity to defeat ${b}.`,
        `${b} got outsmarted in the weirdest possible way.`,
        `${a} proved superior in an absurd showdown.`,
        `${b} underestimated ${a} and paid the price.`
    ];

    const winner = Math.random() > 0.5 ? a : b;

    return {
        winner,
        reason:
            reasons[Math.floor(Math.random() * reasons.length)]
    };
}

// -------------------------
// TOURNAMENT
// -------------------------
async function runTournament(channel, players) {
    let round = 1;

    while (players.length > 1) {
        await channel.send(
            `## ⚔️ Round ${round}\nPlayers Remaining: ${players.length}`
        );

        const nextRound = [];

        for (let i = 0; i < players.length; i += 2) {
            const p1 = players[i];
            const p2 = players[i + 1];

            if (!p2) {
                nextRound.push(p1);

                await channel.send(
                    `🏆 ${p1.user.username} advances automatically!`
                );

                continue;
            }

            const result = judgeBattle(
                p1.creation,
                p2.creation
            );

            const winner =
                result.winner === p1.creation ? p1 : p2;

            nextRound.push(winner);

            const embed = new EmbedBuilder()
                .setTitle('⚔️ Clash Battle')
                .setDescription(
                    `**${p1.user.username}** → ${p1.creation}\n` +
                    `VS\n` +
                    `**${p2.user.username}** → ${p2.creation}\n\n` +
                    `🏆 Winner: **${result.winner}**\n\n` +
                    `💬 ${result.reason}`
                );

            await channel.send({
                embeds: [embed]
            });
        }

        players = nextRound;
        round++;
    }

    const champion = players[0];

    await channel.send(
        `# 👑 Champion: ${champion.user.username}\n` +
        `Creation: **${champion.creation}**`
    );
}

// -------------------------
// INTERACTION HANDLER
// -------------------------
client.on(Events.InteractionCreate, async interaction => {

    // Slash command
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'clash_br') {

            if (activeGames.has(interaction.guild.id)) {
                return interaction.reply({
                    content:
                        'A game is already running.',
                    ephemeral: true
                });
            }

            const game = {
                players: new Map()
            };

            activeGames.set(
                interaction.guild.id,
                game
            );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('join_clash')
                    .setLabel('Join Battle')
                    .setStyle(ButtonStyle.Success)
            );

            await interaction.reply({
                content:
                    '⚔️ **Clash of Creations Battle Royale Started!**\n\n' +
                    'You have **3 minutes** to join.\n' +
                    'Press the button below!',
                components: [row]
            });

            // wait 3 mins
            setTimeout(async () => {

                if (game.players.size === 0) {
                    await interaction.followUp(
                        'Nobody joined.'
                    );

                    activeGames.delete(
                        interaction.guild.id
                    );

                    return;
                }

                await interaction.followUp(
                    '📝 Submission phase started!\n' +
                    'Click **Join Battle** again to submit creation.\n' +
                    'You have **3 minutes**.'
                );

                // submission timer
                setTimeout(async () => {

                    const validPlayers =
                        [...game.players.values()]
                        .filter(p => p.creation);

                    if (validPlayers.length < 2) {
                        await interaction.followUp(
                            'Not enough players submitted.'
                        );

                        activeGames.delete(
                            interaction.guild.id
                        );

                        return;
                    }

                    await interaction.followUp(
                        `🔥 Tournament starting with **${validPlayers.length} players**`
                    );

                    await runTournament(
                        interaction.channel,
                        validPlayers
                    );

                    activeGames.delete(
                        interaction.guild.id
                    );

                }, 180000);

            }, 180000);
        }
    }

    // JOIN BUTTON
    if (interaction.isButton()) {
        if (interaction.customId === 'join_clash') {

            const game =
                activeGames.get(
                    interaction.guild.id
                );

            if (!game) {
                return interaction.reply({
                    content:
                        'No active game.',
                    ephemeral: true
                });
            }

            if (
                !game.players.has(
                    interaction.user.id
                )
            ) {
                game.players.set(
                    interaction.user.id,
                    {
                        user: interaction.user,
                        creation: null
                    }
                );
            }

            const modal = new ModalBuilder()
                .setCustomId('submit_creation')
                .setTitle('Submit Creation');

            const input =
                new TextInputBuilder()
                .setCustomId('creation')
                .setLabel(
                    'Your creation'
                )
                .setPlaceholder(
                    'Dinosaur, Batman, Internet...'
                )
                .setStyle(
                    TextInputStyle.Short
                )
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder()
                .addComponents(input)
            );

            await interaction.showModal(
                modal
            );
        }
    }

    // MODAL SUBMIT
    if (interaction.isModalSubmit()) {

        if (
            interaction.customId ===
            'submit_creation'
        ) {

            const game =
                activeGames.get(
                    interaction.guild.id
                );

            if (!game) return;

            const creation =
                interaction.fields.getTextInputValue(
                    'creation'
                );

            const player =
                game.players.get(
                    interaction.user.id
                );

            if (!player) return;

            player.creation = creation;

            await interaction.reply({
                content:
                    `✅ Submitted: **${creation}**`,
                ephemeral: true
            });
        }
    }
});

client.login(process.env.TOKEN);

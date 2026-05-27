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
    Events,
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');

require('dotenv').config();

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

const activeGames = new Map();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const commands = [
    new SlashCommandBuilder()
        .setName('clash_br')
        .setDescription('Start Clash of Creations Battle Royale')
        .addStringOption(option =>
            option
                .setName('themed')
                .setDescription('Set true to enable AI-generated theme voting')
                .setRequired(true)
                .addChoices(
                    { name: 'true', value: 'true' },
                    { name: 'false', value: 'false' }
                )
        )
        .addStringOption(option =>
            option
                .setName('custom_theme')
                .setDescription('Optional custom inspiration for AI themes')
                .setRequired(false)
        )
        .toJSON()
];

async function deployCommandsOnStartup() {
    const appId = process.env.CLIENT_ID || process.env.APPLICATION_ID;
    const guildId = process.env.GUILD_ID;
    const token = process.env.TOKEN;

    if (!token) {
        throw new Error('Missing TOKEN in .env');
    }

    if (!appId) {
        throw new Error('Missing CLIENT_ID (or APPLICATION_ID) in .env');
    }

    const rest = new REST({ version: '10' }).setToken(token);

    console.log('Deploying slash command(s) from index.js startup...');

    if (guildId) {
        await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });
        console.log(`✅ Guild commands deployed to guild ${guildId}`);
    } else {
        await rest.put(Routes.applicationCommands(appId), { body: commands });
        console.log('✅ Global commands deployed (can take up to 1 hour to appear).');
    }
}

client.once(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}`);
});


function buildFallbackThemes(customThemeHint) {
    const seed = (customThemeHint || 'Creative').trim();

    return [
        `${seed} Legends`,
        `${seed} Tech vs Magic`,
        `${seed} Mythic Showdown`
    ];
}

function parseThemes(text) {
    const lines = text
        .split('\n')
        .map(line => line.replace(/^[-*\d.)\s]+/, '').trim())
        .filter(Boolean);

    return lines.slice(0, 3);
}

async function getThemesFromAI(customThemeHint) {
    if (!OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is missing in environment variables.');
    }

    const prompt = `Give exactly 3 short creative battle themes for a game called Clash of Creations.\n${
        customThemeHint ? `Use this inspiration: ${customThemeHint}\n` : ''
    }Respond as 3 bullet points only.`;

    const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
            model: 'gpt-4.1-mini',
            input: prompt,
            max_output_tokens: 120
        })
    });

    if (!response.ok) {
        throw new Error(`OpenAI theme request failed: ${response.status}`);
    }

    const data = await response.json();
    const text = data.output_text || '';
    const themes = parseThemes(text);

    if (themes.length < 3) {
        throw new Error('Could not extract 3 themes from AI response.');
    }

    return themes.slice(0, 3);
}

async function judgeBattleAI(a, b, theme) {
    if (!OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is missing in environment variables.');
    }

    const prompt = [
        'You are a creative battle judge for Clash of Creations.',
        `Theme: ${theme || 'No theme'}.`,
        `Contestant A weapon: ${a}`,
        `Contestant B weapon: ${b}`,
        'Choose a winner fairly based on creativity and matchup logic.',
        'Respond in strict JSON: {"winner":"A or B","reason":"short reason"}'
    ].join('\n');

    const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
            model: 'gpt-4.1-mini',
            input: prompt,
            max_output_tokens: 180
        })
    });

    if (!response.ok) {
        throw new Error(`OpenAI judge request failed: ${response.status}`);
    }

    const data = await response.json();
    const text = data.output_text || '{}';

    let parsed;

    try {
        parsed = JSON.parse(text);
    } catch {
        parsed = { winner: Math.random() > 0.5 ? 'A' : 'B', reason: text || 'Wild clash.' };
    }

    return {
        winner: parsed.winner === 'B' ? b : a,
        reason: parsed.reason || 'A legendary showdown decided by AI.'
    };
}

async function runTournament(channel, players, theme) {
    let round = 1;

    while (players.length > 1) {
        await channel.send(`## ⚔️ Round ${round}\nTheme: **${theme || 'Open'}**\nPlayers Remaining: ${players.length}`);

        const nextRound = [];

        for (let i = 0; i < players.length; i += 2) {
            const p1 = players[i];
            const p2 = players[i + 1];

            if (!p2) {
                nextRound.push(p1);
                await channel.send(`🏆 ${p1.user.username} advances automatically!`);
                continue;
            }

            let result;
            try {
                result = await judgeBattleAI(p1.creation, p2.creation, theme);
            } catch {
                result = { winner: p1.creation, reason: 'AI fallback: random chaos advantage.' };
            }

            const winner = result.winner === p1.creation ? p1 : p2;
            nextRound.push(winner);

            const embed = new EmbedBuilder()
                .setTitle('⚔️ Clash Battle')
                .setDescription(
                    `Theme: **${theme || 'Open'}**\n\n` +
                        `**${p1.user.username}** → ${p1.creation}\nVS\n**${p2.user.username}** → ${p2.creation}\n\n` +
                        `🏆 Winner: **${winner.user.username}** (${result.winner})\n\n💬 ${result.reason}`
                );

            await channel.send({ embeds: [embed] });
        }

        players = nextRound;
        round++;
    }

    const champion = players[0];
    await channel.send(`# 👑 Champion: ${champion.user.username}\nWeapon: **${champion.creation}**\nTheme: **${theme || 'Open'}**`);
}

function normalizeFlag(v) {
    return String(v).toLowerCase() === 'true';
}

client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isChatInputCommand() && interaction.commandName === 'clash_br') {
        if (activeGames.has(interaction.guild.id)) {
            return interaction.reply({ content: 'A game is already running.', ephemeral: true });
        }

        await interaction.deferReply();

        const themed = normalizeFlag(interaction.options.getString('themed') || 'false');
        const customTheme = interaction.options.getString('custom_theme') || '';

        const game = {
            players: new Map(),
            themed,
            customTheme,
            chosenTheme: null,
            themeVotes: new Map(),
            themeOptions: []
        };

        activeGames.set(interaction.guild.id, game);

        if (themed) {
            try {
                game.themeOptions = await getThemesFromAI(customTheme);
            } catch (err) {
                game.themeOptions = buildFallbackThemes(customTheme);

                await interaction.followUp(
                    `⚠️ OpenAI theme generation is rate-limited right now (${err.message}). Using fallback themes.`
                );
            }

            const row = new ActionRowBuilder().addComponents(
                ...game.themeOptions.map((theme, idx) =>
                    new ButtonBuilder().setCustomId(`vote_theme_${idx}`).setLabel(`Vote ${idx + 1}`).setStyle(ButtonStyle.Primary)
                )
            );

            await interaction.editReply({
                content: `🎭 **Themed Clash Mode**\nVote for the battle theme (60s):\n` + game.themeOptions.map((t, i) => `${i + 1}. ${t}`).join('\n'),
                components: [row]
            });

            setTimeout(async () => {
                const counts = [0, 1, 2].map(i => [...game.themeVotes.values()].filter(v => v === i).length);
                const best = counts.indexOf(Math.max(...counts));
                game.chosenTheme = game.themeOptions[best] || game.themeOptions[0];

                await interaction.followUp(`✅ Theme selected: **${game.chosenTheme}**\nJoin phase starts now (3 minutes).`);

                const joinRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('join_clash').setLabel('Join Battle').setStyle(ButtonStyle.Success)
                );

                await interaction.followUp({ content: 'Press button to join.', components: [joinRow] });
            }, 60000);
        } else {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('join_clash').setLabel('Join Battle').setStyle(ButtonStyle.Success)
            );

            await interaction.editReply({ content: '⚔️ Clash started! Join in 3 minutes.', components: [row] });
        }

        const joinDelay = themed ? 60000 : 0;

        setTimeout(() => {
            interaction.followUp('📝 Submission phase started! Join button opens weapon modal. You have 3 minutes.');

            setTimeout(async () => {
                const validPlayers = [...game.players.values()].filter(p => p.creation);
                if (validPlayers.length < 2) {
                    await interaction.followUp('Not enough players submitted.');
                    activeGames.delete(interaction.guild.id);
                    return;
                }

                await interaction.followUp(`🔥 Tournament starting with **${validPlayers.length} players**`);
                await runTournament(interaction.channel, validPlayers, game.chosenTheme);
                activeGames.delete(interaction.guild.id);
            }, 180000);
        }, joinDelay + 180000);
    }

    if (interaction.isButton()) {
        const game = activeGames.get(interaction.guild.id);
        if (!game) return interaction.reply({ content: 'No active game.', ephemeral: true });

        if (interaction.customId.startsWith('vote_theme_')) {
            const picked = Number(interaction.customId.split('_').pop());
            game.themeVotes.set(interaction.user.id, picked);
            return interaction.reply({ content: `Vote saved for theme #${picked + 1}.`, ephemeral: true });
        }

        if (interaction.customId === 'join_clash') {
            if (!game.players.has(interaction.user.id)) {
                game.players.set(interaction.user.id, { user: interaction.user, creation: null });
            }

            const modal = new ModalBuilder().setCustomId('submit_creation').setTitle('Submit Weapon');
            const input = new TextInputBuilder()
                .setCustomId('creation')
                .setLabel(game.themed ? `Weapon for theme: ${game.chosenTheme || 'pending'}` : 'Your weapon')
                .setPlaceholder('Excalibur, Laser Violin, Thunder Gauntlet...')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(input));
            return interaction.showModal(modal);
        }
    }

    if (interaction.isModalSubmit() && interaction.customId === 'submit_creation') {
        const game = activeGames.get(interaction.guild.id);
        if (!game) return;

        const creation = interaction.fields.getTextInputValue('creation');
        const player = game.players.get(interaction.user.id);
        if (!player) return;

        player.creation = creation;

        await interaction.reply({
            content: game.themed
                ? `✅ Submitted weapon: **${creation}**\nTheme reminder: **${game.chosenTheme || 'Pending'}**`
                : `✅ Submitted weapon: **${creation}**`,
            ephemeral: true
        });
    }
});

(async () => {
    try {
        await deployCommandsOnStartup();
        await client.login(process.env.TOKEN);
    } catch (err) {
        console.error('Startup failed:', err.message || err);
        process.exit(1);
    }
})();

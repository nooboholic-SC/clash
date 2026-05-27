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

const THEME_VOTE_MS = 60000;
const JOIN_MS = 60000;
const SUBMIT_MS = 60000;

const SIMPLE_RANDOM_THEMES = ['superhero', 'maths', 'soft things', 'hard things', 'animals', 'space', 'ocean', 'robots'];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const activeGames = new Map();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const commands = [
  new SlashCommandBuilder()
    .setName('clash_br')
    .setDescription('Start Clash of Creations Battle Royale')
    .addStringOption(option =>
      option
        .setName('themed')
        .setDescription('Set true to enable theme voting')
        .setRequired(true)
        .addChoices({ name: 'true', value: 'true' }, { name: 'false', value: 'false' })
    )
    .addStringOption(option => option.setName('custom_theme').setDescription('Optional custom inspiration').setRequired(false))
    .toJSON()
];

async function deployCommandsOnStartup() {
  const appId = process.env.CLIENT_ID || process.env.APPLICATION_ID;
  const guildId = process.env.GUILD_ID;
  const token = process.env.TOKEN;
  if (!token) throw new Error('Missing TOKEN in .env');
  if (!appId) throw new Error('Missing CLIENT_ID (or APPLICATION_ID) in .env');
  const rest = new REST({ version: '10' }).setToken(token);
  if (guildId) await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });
  else await rest.put(Routes.applicationCommands(appId), { body: commands });
}

client.once(Events.ClientReady, () => console.log(`Logged in as ${client.user.tag}`));

function normalizeFlag(v) {
  return String(v).toLowerCase() === 'true';
}

function buildSimpleThemes() {
  const shuffled = [...SIMPLE_RANDOM_THEMES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3);
}

function joinedList(game) {
  const names = [...game.players.values()].map(p => p.user.username);
  return names.length ? names.join(', ') : 'Nobody yet';
}

async function judgeBattleAI(a, b, theme) {
  if (!OPENAI_API_KEY) {
    return { winner: 'A', reason: `${a} has the stronger practical advantage.` };
  }

  const prompt = [
    'Decide a 1v1 weapon battle winner using practical facts/logic.',
    `Theme: ${theme || 'open'}`,
    `Weapon A: ${a}`,
    `Weapon B: ${b}`,
    'Return strict JSON: {"winner":"A or B","reason":"one-line fact/story why winner beats loser"}'
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({ model: 'gpt-4.1-mini', input: prompt, max_output_tokens: 200 })
  });

  if (!response.ok) {
    return { winner: Math.random() > 0.5 ? 'A' : 'B', reason: `${a} vs ${b}: one had better matchup timing.` };
  }

  const data = await response.json();
  const text = data.output_text || '{}';
  try {
    return JSON.parse(text);
  } catch {
    return { winner: Math.random() > 0.5 ? 'A' : 'B', reason: text.slice(0, 150) || 'Closer matchup, tiny edge decides it.' };
  }
}

async function runTournament(channel, players, theme) {
  let round = 1;
  while (players.length > 1) {
    await channel.send(`## ⚔️ Round ${round} (1v1)\nTheme: **${theme || 'open'}**\nPlayers: ${players.length}`);
    const nextRound = [];

    for (let i = 0; i < players.length; i += 2) {
      const p1 = players[i];
      const p2 = players[i + 1];

      if (!p2) {
        nextRound.push(p1);
        await channel.send(`🏆 ${p1.user.username} advances (no opponent).`);
        continue;
      }

      const decision = await judgeBattleAI(p1.weapon, p2.weapon, theme);
      const winner = decision.winner === 'B' ? p2 : p1;
      nextRound.push(winner);

      const embed = new EmbedBuilder()
        .setTitle('⚔️ 1v1 Battle')
        .setDescription(
          `**${p1.user.username}** (${p1.weapon}) VS **${p2.user.username}** (${p2.weapon})\n` +
            `🏆 Winner: **${winner.user.username}**\n` +
            `📘 ${decision.reason || 'Winner had better battle advantage.'}`
        );
      await channel.send({ embeds: [embed] });
    }

    players = nextRound;
    round++;
  }

  await channel.send(`# 👑 Champion: ${players[0].user.username}\nWeapon: **${players[0].weapon}**`);
}

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand() && interaction.commandName === 'clash_br') {
    if (activeGames.has(interaction.guild.id)) return interaction.reply({ content: 'A game is already running.', ephemeral: true });
    await interaction.deferReply();

    const themed = normalizeFlag(interaction.options.getString('themed') || 'false');
    const game = {
      phase: themed ? 'theme_vote' : 'join',
      players: new Map(),
      themed,
      themeOptions: themed ? buildSimpleThemes() : [],
      themeVotes: new Map(),
      chosenTheme: null,
      hostInteraction: interaction
    };
    activeGames.set(interaction.guild.id, game);

    if (themed) {
      const voteRow = new ActionRowBuilder().addComponents(
        ...game.themeOptions.map((name, idx) => new ButtonBuilder().setCustomId(`vote_theme_${idx}`).setLabel(name).setStyle(ButtonStyle.Primary))
      );

      await interaction.editReply({
        content: `🎭 Vote theme (1 minute):`,
        components: [voteRow]
      });

      setTimeout(async () => {
        if (!activeGames.has(interaction.guild.id)) return;
        const counts = [0, 1, 2].map(i => [...game.themeVotes.values()].filter(v => v === i).length);
        const best = counts.indexOf(Math.max(...counts));
        game.chosenTheme = game.themeOptions[best] || game.themeOptions[0];
        game.phase = 'join';

        const joinRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('join_clash').setLabel('Join Battle').setStyle(ButtonStyle.Success)
        );
        await interaction.followUp({ content: `✅ Theme: **${game.chosenTheme}**\nJoin phase (1 minute).\nJoined: ${joinedList(game)}`, components: [joinRow] });

        setTimeout(async () => {
          if (!activeGames.has(interaction.guild.id)) return;
          game.phase = 'submit';
          const submitRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('submit_weapon_open').setLabel('Submit Weapon').setStyle(ButtonStyle.Primary)
          );
          await interaction.followUp({ content: `📝 Join closed.\nPlayers: ${joinedList(game)}\nSubmit phase (1 minute).`, components: [submitRow] });

          setTimeout(async () => {
            if (!activeGames.has(interaction.guild.id)) return;
            const validPlayers = [...game.players.values()].filter(p => p.weapon);
            if (validPlayers.length < 2) {
              await interaction.followUp('Not enough weapon submissions.');
              activeGames.delete(interaction.guild.id);
              return;
            }
            await interaction.followUp(`🔥 Tournament starts with ${validPlayers.length} players.`);
            await runTournament(interaction.channel, validPlayers, game.chosenTheme);
            activeGames.delete(interaction.guild.id);
          }, SUBMIT_MS);
        }, JOIN_MS);
      }, THEME_VOTE_MS);
    } else {
      game.phase = 'join';
      const joinRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('join_clash').setLabel('Join Battle').setStyle(ButtonStyle.Success));
      await interaction.editReply({ content: `⚔️ Open mode. Join phase (1 minute).\nJoined: ${joinedList(game)}`, components: [joinRow] });

      setTimeout(async () => {
        if (!activeGames.has(interaction.guild.id)) return;
        game.phase = 'submit';
        const submitRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('submit_weapon_open').setLabel('Submit Weapon').setStyle(ButtonStyle.Primary));
        await interaction.followUp({ content: `📝 Join closed.\nPlayers: ${joinedList(game)}\nSubmit phase (1 minute).`, components: [submitRow] });

        setTimeout(async () => {
          if (!activeGames.has(interaction.guild.id)) return;
          const validPlayers = [...game.players.values()].filter(p => p.weapon);
          if (validPlayers.length < 2) {
            await interaction.followUp('Not enough weapon submissions.');
            activeGames.delete(interaction.guild.id);
            return;
          }
          await interaction.followUp(`🔥 Tournament starts with ${validPlayers.length} players.`);
          await runTournament(interaction.channel, validPlayers, null);
          activeGames.delete(interaction.guild.id);
        }, SUBMIT_MS);
      }, JOIN_MS);
    }
  }

  if (interaction.isButton()) {
    const game = activeGames.get(interaction.guild.id);
    if (!game) return interaction.reply({ content: 'No active game.', ephemeral: true });

    if (interaction.customId.startsWith('vote_theme_')) {
      if (game.phase !== 'theme_vote') return interaction.reply({ content: 'Theme voting is closed.', ephemeral: true });
      const picked = Number(interaction.customId.split('_').pop());
      game.themeVotes.set(interaction.user.id, picked);
      return interaction.reply({ content: `Voted: ${game.themeOptions[picked]}`, ephemeral: true });
    }

    if (interaction.customId === 'join_clash') {
      if (game.phase !== 'join') return interaction.reply({ content: 'Join phase is closed.', ephemeral: true });
      if (!game.players.has(interaction.user.id)) game.players.set(interaction.user.id, { user: interaction.user, weapon: null });
      await interaction.reply({ content: `✅ Joined.\nPlayers: ${joinedList(game)}`, ephemeral: true });
      await game.hostInteraction.followUp(`👥 Updated players: ${joinedList(game)}`);
      return;
    }

    if (interaction.customId === 'submit_weapon_open') {
      if (game.phase !== 'submit') return interaction.reply({ content: 'Submission is closed.', ephemeral: true });
      if (!game.players.has(interaction.user.id)) return interaction.reply({ content: 'Join first before submitting.', ephemeral: true });

      const modal = new ModalBuilder().setCustomId('submit_weapon').setTitle('Submit Weapon');
      const input = new TextInputBuilder()
        .setCustomId('weapon')
        .setLabel(game.themed ? `Weapon for ${game.chosenTheme}` : 'Your weapon')
        .setPlaceholder('Sword, calculator cannon, pillow hammer...')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }
  }

  if (interaction.isModalSubmit() && interaction.customId === 'submit_weapon') {
    const game = activeGames.get(interaction.guild.id);
    if (!game || game.phase !== 'submit') return interaction.reply({ content: 'Submission is closed.', ephemeral: true });
    const player = game.players.get(interaction.user.id);
    if (!player) return interaction.reply({ content: 'Join first.', ephemeral: true });
    player.weapon = interaction.fields.getTextInputValue('weapon');
    await interaction.reply({ content: `✅ Submitted: **${player.weapon}**`, ephemeral: true });
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

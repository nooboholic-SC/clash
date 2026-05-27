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

const JOIN_MS = 60000;
const THEME_VOTE_MS = 60000;
const SUBMIT_MS = 120000;
const THEMES = ['superhero', 'maths', 'soft things', 'hard things', 'animals', 'space', 'ocean', 'robots'];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const activeGames = new Map();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const commands = [
  new SlashCommandBuilder()
    .setName('clash_br')
    .setDescription('Start Clash of Creations Battle Royale')
    .addStringOption(option => option.setName('themed').setDescription('Enable themed voting').setRequired(true).addChoices({ name: 'true', value: 'true' }, { name: 'false', value: 'false' }))
    .toJSON()
];

const joinRow = () => new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('join_clash').setLabel('Join Battle').setStyle(ButtonStyle.Success));
const submitRow = () => new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('submit_weapon_open').setLabel('Submit Creation').setStyle(ButtonStyle.Primary));
const OPENING_ROUND_NAME = 'Opening Round ⚔️';

function playerMentions(game, withStatus = false) {
  const lines = [...game.players.values()].map(p => {
    if (!withStatus) return `${p.user.username}`;
    return `${p.weapon ? ':checked:' : ':x:'} @${p.user.username}`;
  });
  return lines.length ? lines.join(', ') : 'Nobody yet';
}

function randomThemes() {
  return [...THEMES].sort(() => Math.random() - 0.5).slice(0, 3);
}

async function deployCommandsOnStartup() {
  const appId = process.env.CLIENT_ID || process.env.APPLICATION_ID;
  const guildId = process.env.GUILD_ID;
  const token = process.env.TOKEN;

  const missing = [];
  if (!token) missing.push('TOKEN');
  if (!appId) missing.push('CLIENT_ID or APPLICATION_ID');

  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }

  const rest = new REST({ version: '10' }).setToken(token);
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });
    console.log(`✅ Commands deployed to guild ${guildId}`);
  } else {
    await rest.put(Routes.applicationCommands(appId), { body: commands });
    console.log('✅ Global commands deployed (can take up to 1 hour).');
  }
}

async function judgeBattleAI(a, b, theme) {
  if (!OPENAI_API_KEY) return { winner: 'A', reason: `${a} has a stronger practical advantage.` };
  const prompt = [
    'Decide 1v1 weapon winner with practical facts.',
    `Theme: ${theme || 'open'}`,
    `Weapon A: ${a}`,
    `Weapon B: ${b}`,
    'Return strict JSON: {"winner":"A or B","reason":"one-line fact/story"}'
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: 'gpt-4.1-mini', input: prompt, max_output_tokens: 180 })
  });

  if (!response.ok) return { winner: Math.random() > 0.5 ? 'A' : 'B', reason: `${a} vs ${b}: one had a better matchup edge.` };
  const data = await response.json();
  try {
    return JSON.parse(data.output_text || '{}');
  } catch {
    return { winner: Math.random() > 0.5 ? 'A' : 'B', reason: 'Small tactical edge decided this clash.' };
  }
}

async function runTournament(channel, players, theme) {
  let round = 1;
  while (players.length > 1) {
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    const pairings = [];
    for (let i = 0; i < shuffled.length; i += 2) {
      if (shuffled[i + 1]) pairings.push(`@${shuffled[i].user.username} vs. @${shuffled[i + 1].user.username}`);
    }
    await channel.send(`Let the battle begin! 🎉\n${players.length} players have entered the arena\nCreations will face off in exciting matchups\nOnly one creation will emerge victorious\nMay the best creation win!\n\nRound ${round} | ${OPENING_ROUND_NAME}\nThere are ${players.length} players remaining.\n\nThe following players will battle it out:\n${pairings.join('\n')}`);
    const next = [];
    for (let i = 0; i < shuffled.length; i += 2) {
      const p1 = shuffled[i];
      const p2 = shuffled[i + 1];
      if (!p2) {
        next.push(p1);
        await channel.send(`🏆 ${p1.user.username} advances (no opponent).`);
        continue;
      }
      await channel.send(`\nClash of Creations: Battle Royale\nBattle between ‎${p1.user.username}‎ and ‎${p2.user.username}‎!\n@${p1.user.username}: ${p1.weapon}\n@${p2.user.username}: ${p2.weapon}\nImage\nRound ${round} | ${OPENING_ROUND_NAME}`);
      const d = await judgeBattleAI(p1.weapon, p2.weapon, theme);
      const w = d.winner === 'B' ? p2 : p1;
      next.push(w);
      await channel.send(`\nClash of Creations: Battle Royale\nThe Victor 🏆\n‎${w.user.username}‎ with ${w.weapon}!\nReason\n${d.reason || 'Winner had the better combat edge.'}`);
    }
    players = next;
    round++;
  }
  await channel.send(`# 👑 Champion: ${players[0].user.username}\nWeapon: **${players[0].weapon}**`);
}

client.once(Events.ClientReady, () => console.log(`Logged in as ${client.user.tag}`));

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand() && interaction.commandName === 'clash_br') {
    if (activeGames.has(interaction.guild.id)) return interaction.reply({ content: 'A game is already running.', ephemeral: true });
    await interaction.deferReply();

    const themed = String(interaction.options.getString('themed')).toLowerCase() === 'true';
    const game = { phase: 'join', themed, players: new Map(), themeOptions: themed ? randomThemes() : [], themeVotes: new Map(), chosenTheme: null, hostInteraction: interaction, submitTimer: null, progressed: false };
    activeGames.set(interaction.guild.id, game);
    await interaction.editReply({ content: `:fight: Clash of Creations: Battle Royale\nStatus\nWaiting for more players (at least 3)\nTheme\nTheme 🎭 will be determined by a vote!\nLenient theme enforcement is enabled.\nPlayers [${game.players.size}]\n${playerMentions(game)}`, components: [joinRow()] });

    setTimeout(async () => {
      if (!activeGames.has(interaction.guild.id)) return;
      if (game.players.size < 3) {
        await interaction.followUp('Not enough joined players.');
        activeGames.delete(interaction.guild.id);
        return;
      }

      if (game.themed) {
        game.phase = 'theme_vote';
        const voteRow = new ActionRowBuilder().addComponents(...game.themeOptions.map((name, idx) => new ButtonBuilder().setCustomId(`vote_theme_${idx}`).setLabel(name).setStyle(ButtonStyle.Primary)));
        await interaction.followUp({ content: `\nClash of Creations: Battle Royale\nTheme Voting Time! 🎨\nVote for your favorite theme! The winning theme will determine what kind of creations you can submit.\n\n${game.themeOptions.map((name, i) => `${name} - Votes: ${[...game.themeVotes.values()].filter(v => v === i).length}`).join('\n')}`, components: [voteRow] });

        setTimeout(async () => {
          if (!activeGames.has(interaction.guild.id)) return;
          const counts = [0, 1, 2].map(i => [...game.themeVotes.values()].filter(v => v === i).length);
          const best = counts.indexOf(Math.max(...counts));
          game.chosenTheme = game.themeOptions[best] || game.themeOptions[0];
          game.phase = 'submit';
          await interaction.followUp(`\nClash of Creations: Battle Royale\nThe Theme Has Been Chosen! 🎉\n${game.chosenTheme} won the vote!\nGet ready to submit your themed creation...`);
          await interaction.followUp({ content: `\nClash of Creations: Battle Royale\nWelcome to Creation Clash: Battle Royale! 🏆\nTheme: ${game.chosenTheme}\nAll submissions must fit this theme!\n\nHow to Play:\nThis game is like rock-paper-scissors, but with a twist!\nSubmit any object, concept, or person you want to fight with\nAn AI judge 🤖 will determine the winner of each match\nWinners advance until only one creation remains\n\n⏳ You have 2 minutes to submit your creation \nPlayers who don't submit in time will be eliminated`, components: [submitRow()] });
          game.submitTimer = setTimeout(() => concludeSubmission(interaction, game), SUBMIT_MS);
        }, THEME_VOTE_MS);
      } else {
        game.phase = 'submit';
        await interaction.followUp({ content: `\nClash of Creations: Battle Royale\nWelcome to Creation Clash: Battle Royale! 🏆\nTheme: Open\nAll submissions must fit this theme!\n\nHow to Play:\nThis game is like rock-paper-scissors, but with a twist!\nSubmit any object, concept, or person you want to fight with\nAn AI judge 🤖 will determine the winner of each match\nWinners advance until only one creation remains\n\n⏳ You have 2 minutes to submit your creation \nPlayers who don't submit in time will be eliminated`, components: [submitRow()] });
        game.submitTimer = setTimeout(() => concludeSubmission(interaction, game), SUBMIT_MS);
      }
    }, JOIN_MS);
  }

  if (interaction.isButton()) {
    const game = activeGames.get(interaction.guild.id);
    if (!game) return interaction.reply({ content: 'No active game.', ephemeral: true });

    if (interaction.customId === 'join_clash') {
      if (game.phase !== 'join') return interaction.reply({ content: 'Join phase is closed.', ephemeral: true });
      if (game.players.has(interaction.user.id)) return interaction.reply({ content: 'You already joined.', ephemeral: true });
      game.players.set(interaction.user.id, { user: interaction.user, weapon: null });
      await interaction.reply({ content: '✅ Joined.', ephemeral: true });
      await game.hostInteraction.editReply({ content: `:fight: Clash of Creations: Battle Royale\nStatus\nWaiting for more players (at least 3)\nTheme\nTheme 🎭 will be determined by a vote!\nLenient theme enforcement is enabled.\nPlayers [${game.players.size}]\n${playerMentions(game)}`, components: [joinRow()] });
      return;
    }

    if (interaction.customId.startsWith('vote_theme_')) {
      if (game.phase !== 'theme_vote') return interaction.reply({ content: 'Theme voting is closed.', ephemeral: true });
      if (!game.players.has(interaction.user.id)) return interaction.reply({ content: 'Only joined players can vote.', ephemeral: true });
      if (game.themeVotes.has(interaction.user.id)) return interaction.reply({ content: 'You already voted.', ephemeral: true });
      const picked = Number(interaction.customId.split('_').pop());
      game.themeVotes.set(interaction.user.id, picked);
      return interaction.reply({ content: `Voted: ${game.themeOptions[picked]}`, ephemeral: true });
    }

    if (interaction.customId === 'submit_weapon_open') {
      if (game.phase !== 'submit') return interaction.reply({ content: 'Submission is closed.', ephemeral: true });
      const player = game.players.get(interaction.user.id);
      if (!player) return interaction.reply({ content: 'Only joined players can submit.', ephemeral: true });
      if (player.weapon) return interaction.reply({ content: 'You already submitted your weapon.', ephemeral: true });
      const modal = new ModalBuilder().setCustomId('submit_weapon').setTitle('Submit Weapon');
      const input = new TextInputBuilder().setCustomId('weapon').setLabel(game.themed ? `Weapon for ${game.chosenTheme}` : 'Your weapon').setPlaceholder('Sword, calculator cannon, pillow hammer...').setStyle(TextInputStyle.Short).setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }
  }

  if (interaction.isModalSubmit() && interaction.customId === 'submit_weapon') {
    const game = activeGames.get(interaction.guild.id);
    if (!game || game.phase !== 'submit') return interaction.reply({ content: 'Submission is closed.', ephemeral: true });
    const player = game.players.get(interaction.user.id);
    if (!player) return interaction.reply({ content: 'Only joined players can submit.', ephemeral: true });
    if (player.weapon) return interaction.reply({ content: 'You already submitted your weapon.', ephemeral: true });
    player.weapon = interaction.fields.getTextInputValue('weapon');
    const submitted = [...game.players.values()].filter(p => p.weapon).length;
    if (submitted === game.players.size && !game.progressed) {
      if (game.submitTimer) clearTimeout(game.submitTimer);
      await concludeSubmission(game.hostInteraction, game);
    }
    return interaction.reply({ content: `✅ Submitted: **${player.weapon}**`, ephemeral: true });
  }
});

async function concludeSubmission(interaction, game) {
  if (game.progressed || !activeGames.has(interaction.guild.id)) return;
  game.progressed = true;
  const valid = [...game.players.values()].filter(p => p.weapon);
  if (valid.length < 2) {
    await interaction.followUp('Not enough weapon submissions.');
    activeGames.delete(interaction.guild.id);
    return;
  }
  await interaction.followUp(`\nClash of Creations: Battle Royale\nAll creations have been submitted!\n${[...game.players.values()].map(p => `${p.weapon ? ':checked:' : ':x:'} @${p.user.username}`).join('\n')}\n\nThink of a creation you want to fight with.`);
  await runTournament(interaction.channel, valid, game.chosenTheme);
  activeGames.delete(interaction.guild.id);
}

(async () => {
  try {
    await deployCommandsOnStartup();
    await client.login(process.env.TOKEN);
  } catch (err) {
    console.error('Startup failed:', err.message || err);
    console.error('Expected .env keys: TOKEN, CLIENT_ID (or APPLICATION_ID), GUILD_ID (optional), OPENAI_API_KEY (optional).');
    process.exit(1);
  }
})();

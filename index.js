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
  SlashCommandBuilder,
  Collection
} = require('discord.js');
require('dotenv').config();

// Import Google Gemini AI
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Game constants
const THEME_VOTE_MS = 60000;     // 60 seconds to vote on theme
const SUBMIT_MS = 120000;        // 120 seconds to submit creations
const MESSAGE_DELAY_MS = 5000;   // 5 second delay between messages for suspense

const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ] 
});

const activeGames = new Collection();

// Helper function to add delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Initialize Gemini AI with correct model names
let genAI = null;
let geminiModel = null;
let geminiAvailable = false;


// List of available Gemini models (try in order)
const GEMINI_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-3-flash',
  'gemini-2.5-flash'
];

if (process.env.GEMINI_API_KEY) {
  try {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    console.log('✅ Gemini AI initialized, testing models...');
  } catch (error) {
    console.error('Failed to initialize Gemini:', error.message);
  }
}

// Function to test and set available Gemini model
async function initializeGeminiModel() {
  if (!genAI) return false;
  
  for (const modelName of GEMINI_MODELS) {
    try {
      const testModel = genAI.getGenerativeModel({ model: modelName });
      // Test with a simple prompt
      const testResult = await testModel.generateContent("Say 'OK'");
      await testResult.response;
      geminiModel = testModel;
      geminiAvailable = true;
      console.log(`✅ Gemini connected successfully using model: ${modelName}`);
      return true;
    } catch (error) {
      console.log(`⚠️ Model ${modelName} not available: ${error.message}`);
    }
  }
  
  console.warn('⚠️ No Gemini models available. Using fallback mode.');
  geminiAvailable = false;
  return false;
}

// Slash command definition
const commands = [
  new SlashCommandBuilder()
    .setName('clash_br')
    .setDescription('🎮 Start an AI-powered Clash of Creations Battle Royale game')
    .addStringOption(option => 
      option.setName('themed')
        .setDescription('Enable theme voting?')
        .setRequired(true)
        .addChoices(
          { name: '🎨 Yes - Theme Vote', value: 'true' },
          { name: '⚔️ No - Open Theme', value: 'false' }
        ))
    .toJSON()
];

// UI Components
const joinRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId('join_clash')
    .setLabel('⚔️ Join Battle')
    .setStyle(ButtonStyle.Success)
    .setEmoji('🎮')
);

const startGameRow = (disabled = false) => new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId('start_game')
    .setLabel('🎯 Start Game')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('🚀')
    .setDisabled(disabled)
);

const submitRow = () => new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId('submit_weapon_open')
    .setLabel('✨ Submit Creation')
    .setStyle(ButtonStyle.Primary)
    .setEmoji('📝')
);

// Helper: Parse JSON from Gemini responses
function parseGeminiResponse(text) {
  if (!text) return null;
  
  try {
    // Remove markdown code blocks if present
    let cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    
    // Try to find JSON in the response
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.log('JSON parse error:', e.message);
  }
  
  return null;
}

// Enhanced fallback themes (no API needed)
function getFallbackThemes() {
  const themePool = [
    'Mythic Guardians', 'Cyber Artifacts', 'Elemental Creatures',
    'Shadow Heroes', 'Neon Villains', 'Ancient Machines',
    'Dragon Slayers', 'Mecha Warriors', 'Shadow Assassins',
    'Crystal Knights', 'Phoenix Order', 'Thunder Gods',
    'Frost Giants', 'Infernal Demons', 'Celestial Beings',
    'Arcane Wizards', 'Steel Titans', 'Venomous Creatures',
    'Cosmic Entities', 'Nature Spirits', 'Time Manipulators',
    'Soul Reapers', 'Star Forgers', 'Dream Weavers'
  ];
  
  // Randomly select 3 unique themes
  const shuffled = [...themePool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled.slice(0, 3);
}

// Gemini AI Theme Generation
async function generateAIThemes() {
  if (!geminiAvailable || !geminiModel) {
    console.warn('⚠️ Gemini not available, using fallback themes');
    return getFallbackThemes();
  }
  
  try {
    const prompt = `Generate exactly 3 unique, exciting, and battle-friendly themes for a creative battle game, do not complicate, use simple things. 
    Examples: "stationary item", "soft things", "body parts"
    
    Important: Return ONLY valid JSON in this exact format (no markdown, no extra text, no explanations):
    {"themes": ["Theme 1", "Theme 2", "Theme 3"]}
    
    Make them creative, epic, and suitable for a battle royale!`;
    
    const result = await geminiModel.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    console.log('Gemini response for themes:', text);
    
    const parsed = parseGeminiResponse(text);
    
    if (parsed?.themes && Array.isArray(parsed.themes) && parsed.themes.length === 3) {
      console.log('✅ Gemini themes generated:', parsed.themes);
      return parsed.themes;
    }
    
    console.warn('Gemini themes invalid format, using fallback');
    return getFallbackThemes();
  } catch (error) {
    console.error('Gemini theme generation error:', error.message);
    if (error.message.includes('404') || error.message.includes('not found')) {
      console.error('⚠️ Model error - trying to reinitialize...');
      await initializeGeminiModel();
    }
    return getFallbackThemes();
  }
}

// Enhanced fallback judgment with theme consideration and humor
function getFallbackJudgment(weaponA, weaponB, playerAName, playerBName, theme) {
  // Calculate creative scores based on keywords and theme relevance
  const getWeaponScore = (weapon, playerName) => {
    let score = 50; // Base score
    
    const epicKeywords = {
      'legendary': 20, 'mythic': 20, 'ancient': 15, 'divine': 20,
      'dragon': 18, 'phoenix': 18, 'god': 25, 'immortal': 20,
      'void': 15, 'infinity': 18, 'cosmic': 17, 'universal': 16,
      'quantum': 15, 'nuclear': 14, 'plasma': 13, 'laser': 12,
      'sword': 10, 'blade': 10, 'hammer': 11, 'axe': 10,
      'cannon': 12, 'rifle': 11, 'gauntlet': 13, 'armor': 10,
      'shadow': 12, 'darkness': 13, 'light': 12, 'holy': 14,
      'death': 15, 'soul': 14, 'chaos': 16, 'order': 14,
      'star': 13, 'galaxy': 15, 'nebula': 14, 'black hole': 18,
      'potato': 5, 'banana': 4, 'spoon': 3, 'fork': 3, 'pan': 6
    };
    
    const lowerWeapon = weapon.toLowerCase();
    for (const [keyword, points] of Object.entries(epicKeywords)) {
      if (lowerWeapon.includes(keyword)) {
        score += points;
      }
    }
    
    // Theme relevance bonus
    if (theme && theme !== 'Open Battle') {
      const themeKeywords = theme.toLowerCase().split(' ');
      let themeRelevance = 0;
      for (const keyword of themeKeywords) {
        if (lowerWeapon.includes(keyword)) {
          themeRelevance += 15;
        }
      }
      score += themeRelevance;
    }
    
    // Add randomness for excitement (between -15 and +15)
    score += Math.floor(Math.random() * 30) - 15;
    
    // Funny name bonus
    if (playerName.toLowerCase().includes('noob')) score -= 10;
    if (playerName.toLowerCase().includes('pro')) score += 10;
    if (playerName.toLowerCase().includes('god')) score += 15;
    
    return Math.max(0, Math.min(100, score));
  };
  
  const scoreA = getWeaponScore(weaponA, playerAName);
  const scoreB = getWeaponScore(weaponB, playerBName);
  const winner = scoreA >= scoreB ? 'A' : 'B';
  const winnerName = winner === 'A' ? playerAName : playerBName;
  const winnerWeapon = winner === 'A' ? weaponA : weaponB;
  const loserWeapon = winner === 'A' ? weaponB : weaponA;
  
  const funnyReasons = [
    `😂 ${winnerWeapon} triumphed over ${loserWeapon}! The battle was so ridiculous that even the judges are confused!`,
    `🍕 ${winnerName} bribed the judges with pizza! ${winnerWeapon} was simply more creative than ${loserWeapon}!`,
    `🎭 While ${loserWeapon} was trying to look cool, ${winnerWeapon} actually did something useful!`,
    `⚡ ${winnerWeapon} defeated ${loserWeapon} in an epic showdown! The loser's weapon was too busy taking selfies.`,
    `🦄 A wild unicorn appeared and helped ${winnerName}! Actually, ${winnerWeapon} was just better.`,
    `🎮 ${winnerWeapon} pressed the "win" button while ${loserWeapon} was still reading instructions!`,
    `🐢 ${loserWeapon} was too slow, like a turtle on vacation. ${winnerWeapon} zoomed past for victory!`,
    `💀 ${winnerWeapon} was so edgy that it cut through ${loserWeapon}'s defenses!`,
    `🎪 This battle was a circus, and ${winnerWeapon} was the main attraction!`
  ];
  
  const epicReasons = [
    `✨ ${winnerWeapon} channeled the power of ancient gods to overwhelm ${loserWeapon}!`,
    `🌋 The battlefield shook as ${winnerWeapon} demonstrated why creativity beats brute force!`,
    `🎯 ${winnerName} perfectly executed their strategy, using ${winnerWeapon} to counter every move!`,
    `⚔️ In a clash of titans, ${winnerWeapon}'s unique properties proved superior!`
  ];
  
  const reasonPool = [...funnyReasons, ...epicReasons];
  
  return {
    winner,
    reason: reasonPool[Math.floor(Math.random() * reasonPool.length)]
  };
}

// Gemini AI Battle Judging with theme consideration and humor
async function judgeBattleAI(weaponA, weaponB, theme, playerAName, playerBName) {
  if (!geminiAvailable || !geminiModel) {
    return getFallbackJudgment(weaponA, weaponB, playerAName, playerBName, theme);
  }
  
  try {
    const prompt = `You are an epic but funny battle judge for a creative tournament.
    
    Theme: ${theme || 'Open Battle'}
    
    Battle: "${weaponA}" (used by ${playerAName}) vs "${weaponB}" (used by ${playerBName})
    
    Consider:
    1. How well each creation fits the theme (if a theme is specified)
    2. Creativity and originality
    3. Practicality in battle
    4. Use humor and fun facts in your decision
    
    Return ONLY valid JSON in this exact format (no markdown, no extra text):
    {"winner": "A", "reason": "A creative, funny 1-2 sentence explanation of why this creation won"}
    
    Choose either "A" or "B" as winner. Make it entertaining!`;
    
    const result = await geminiModel.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    const parsed = parseGeminiResponse(text);
    
    if ((parsed?.winner === 'A' || parsed?.winner === 'B') && parsed?.reason) {
      return parsed;
    }
    
    // Fallback if parsing fails
    return getFallbackJudgment(weaponA, weaponB, playerAName, playerBName, theme);
  } catch (error) {
    console.error('Gemini battle judging error:', error.message);
    if (error.message.includes('404') || error.message.includes('not found')) {
      console.error('⚠️ Model error - trying to reinitialize...');
      await initializeGeminiModel();
    }
    return getFallbackJudgment(weaponA, weaponB, playerAName, playerBName, theme);
  }
}

// Deploy slash commands
async function deployCommands() {
  const token = process.env.TOKEN;
  const clientId = process.env.CLIENT_ID || process.env.APPLICATION_ID;
  const guildId = process.env.GUILD_ID;
  
  if (!token || !clientId) {
    throw new Error('Missing TOKEN or CLIENT_ID in .env');
  }
  
  const rest = new REST({ version: '10' }).setToken(token);
  
  try {
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
      console.log(`✅ Commands deployed to guild: ${guildId}`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
      console.log('✅ Global commands deployed (may take up to 1 hour)');
    }
  } catch (error) {
    console.error('Command deployment error:', error);
    throw error;
  }
}

// Function to update submission status message
async function updateSubmissionStatus(interaction, game) {
  const submittedCount = [...game.players.values()].filter(p => p.weapon).length;
  const totalPlayers = game.players.size;
  
  const statusEmbed = new EmbedBuilder()
    .setTitle('⚔️ SUBMISSION PHASE ⚔️')
    .setColor(0x3498DB)
    .setDescription(`## Theme: **${game.chosenTheme || 'Open Battle'}**\n\n**Status:** ${submittedCount}/${totalPlayers} creations submitted\n**Time Remaining:** ${Math.max(0, Math.floor((SUBMIT_MS - (Date.now() - game.submitStartTime)) / 1000))} seconds\n\n**Players:**\n${[...game.players.values()].map(p => `${p.weapon ? '✅' : '⏰'} ${p.displayName}`).join('\n')}\n\n🎯 *Creations will be revealed when the tournament begins!*`)
    .setTimestamp();
  
  if (game.statusMessage) {
    await game.statusMessage.edit({ embeds: [statusEmbed] });
  } else {
    const msg = await interaction.followUp({ embeds: [statusEmbed] });
    game.statusMessage = msg;
  }
}

// Shuffle players once so every fixture and battle uses the same bracket order.
function shufflePlayers(players) {
  const shuffled = [...players];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function getPlayerName(player) {
  return player.displayName || player.user.displayName || player.user.username;
}

function getByeCounts(battleHistory) {
  const byeCounts = new Map();

  battleHistory.forEach(battle => {
    if (battle.bye) {
      byeCounts.set(battle.bye, (byeCounts.get(battle.bye) || 0) + 1);
    }
  });

  return byeCounts;
}

function selectByePlayer(players, battleHistory) {
  if (players.length % 2 === 0) return null;

  const byeCounts = getByeCounts(battleHistory);
  const fewestByes = Math.min(...players.map(player => byeCounts.get(player.user.id) || 0));

  // Prefer the last eligible bracket slot so the first visible pairs stay intact.
  for (let i = players.length - 1; i >= 0; i--) {
    const player = players[i];
    if ((byeCounts.get(player.user.id) || 0) === fewestByes) {
      return player;
    }
  }

  return players[players.length - 1];
}

function buildRoundPlan(players, battleHistory = []) {
  const byePlayer = selectByePlayer(players, battleHistory);
  const playersToMatch = byePlayer
    ? players.filter(player => player.user.id !== byePlayer.user.id)
    : [...players];
  const matches = [];

  for (let i = 0; i < playersToMatch.length; i += 2) {
    const playerA = playersToMatch[i];
    const playerB = playersToMatch[i + 1];

    if (playerA && playerB) {
      matches.push([playerA, playerB]);
    } else if (playerA) {
      // Defensive fallback for unexpected malformed input.
      return {
        matches,
        byePlayer: playerA
      };
    }
  }

  return { matches, byePlayer };
}

function formatRoundPlan(roundPlan) {
  const matchups = roundPlan.matches.map(([playerA, playerB]) => {
    return `⚔️ ${getPlayerName(playerA)} vs ${getPlayerName(playerB)}`;
  });

  if (roundPlan.byePlayer) {
    matchups.push(`🎲 ${getPlayerName(roundPlan.byePlayer)} gets a BYE`);
  }

  return matchups.length > 0 ? matchups.join('\n') : 'No matchups available.';
}

// Generate battle fixture (bracket)
function generateBattleFixture(players, theme, battleHistory = []) {
  const roundPlan = buildRoundPlan(players, battleHistory);
  let fixtureText = `🎭 **Theme:** ${theme || 'Open Battle'}\n👥 **Total Combatants:** ${players.length}\n\n`;
  fixtureText += `**📋 Round 1 Matchups:**\n`;
  fixtureText += formatRoundPlan(roundPlan)
    .split('\n')
    .map((matchup, idx) => `${idx + 1}. ${matchup}`)
    .join('\n');

  fixtureText += `\n\n🎲 *Bracket order is locked before Round 1*\n🤖 *Supreme Leader will decide each battle*`;

  return fixtureText;
}

// Run the tournament with a locked bracket fixture.
async function runTournament(channel, players, theme) {
  let round = 1;
  let remainingPlayers = shufflePlayers(players);
  const battleHistory = [];

  // Generate and show the same Round 1 fixture that will actually be played.
  const fixtureText = generateBattleFixture(remainingPlayers, theme, battleHistory);
  const fixtureEmbed = new EmbedBuilder()
    .setTitle('🏆 CLASH OF CREATIONS - TOURNAMENT BRACKET 🏆')
    .setColor(0xFF4500)
    .setDescription(fixtureText)
    .setTimestamp();

  await channel.send({ embeds: [fixtureEmbed] });
  await delay(MESSAGE_DELAY_MS);

  // Tournament begins announcement
  const beginEmbed = new EmbedBuilder()
    .setTitle('⚔️ THE TOURNAMENT BEGINS! ⚔️')
    .setColor(0xFFD700)
    .setDescription('Get ready for an epic battle royale! Each match will be judged by Supreme Leader based on creativity, theme relevance, and battle logic.\n\nMay the best creation win!')
    .setTimestamp();

  await channel.send({ embeds: [beginEmbed] });
  await delay(MESSAGE_DELAY_MS);

  while (remainingPlayers.length > 1) {
    const roundPlan = buildRoundPlan(remainingPlayers, battleHistory);
    const matchupText = formatRoundPlan(roundPlan);
    const roundEmbed = new EmbedBuilder()
      .setTitle(`🔰 ROUND ${round} - ${remainingPlayers.length} Warriors Remain 🔰`)
      .setColor(0x4169E1)
      .setDescription(`⚔️ **Matchups for Round ${round}:**\n\n${matchupText}\n\n🎲 The battles will now commence...`)
      .setTimestamp();

    await channel.send({ embeds: [roundEmbed] });
    await delay(MESSAGE_DELAY_MS);

    const nextRound = [];

    if (roundPlan.byePlayer) {
      const byeCounts = getByeCounts(battleHistory);
      const byePlayer = roundPlan.byePlayer;
      nextRound.push(byePlayer);

      const byeEmbed = new EmbedBuilder()
        .setTitle('🎲 BYE ROUND')
        .setColor(0x9370DB)
        .setDescription(`🏅 ${getPlayerName(byePlayer)} gets a BYE and advances automatically to the next round!\n\n*${getPlayerName(byePlayer)} had ${(byeCounts.get(byePlayer.user.id) || 0)} bye(s) before this round*`)
        .setTimestamp();

      await channel.send({ embeds: [byeEmbed] });
      await delay(MESSAGE_DELAY_MS);

      battleHistory.push({
        round,
        battle: `${getPlayerName(byePlayer)} - BYE`,
        winner: getPlayerName(byePlayer),
        reason: 'Received a bye to the next round!',
        bye: byePlayer.user.id
      });
    }

    for (const [p1, p2] of roundPlan.matches) {
      // Battle announcement - reveal creations immediately
      const battleEmbed = new EmbedBuilder()
        .setTitle(`⚔️ BATTLE: ${getPlayerName(p1)} vs ${getPlayerName(p2)} ⚔️`)
        .setColor(0xFFD700)
        .addFields(
          { name: `${getPlayerName(p1)}'s Creation`, value: `**${p1.weapon}**`, inline: true },
          { name: `${getPlayerName(p2)}'s Creation`, value: `**${p2.weapon}**`, inline: true },
          { name: 'Theme', value: theme || 'Open Battle', inline: true }
        )
        .setTimestamp();

      await channel.send({ embeds: [battleEmbed] });
      await delay(MESSAGE_DELAY_MS);

      // Get AI judgment
      const judgment = await judgeBattleAI(p1.weapon, p2.weapon, theme, getPlayerName(p1), getPlayerName(p2));
      const winner = judgment.winner === 'B' ? p2 : p1;
      nextRound.push(winner);

      battleHistory.push({
        round,
        battle: `${getPlayerName(p1)} (${p1.weapon}) vs ${getPlayerName(p2)} (${p2.weapon})`,
        winner: getPlayerName(winner),
        reason: judgment.reason
      });

      // Victory announcement
      const victoryEmbed = new EmbedBuilder()
        .setTitle(`🏅 VICTORY: ${getPlayerName(winner)} advances! 🏅`)
        .setColor(0x00FF00)
        .setDescription(judgment.reason)
        .addFields(
          { name: 'Winning Creation', value: winner.weapon, inline: true },
          { name: 'Status', value: '✅ Moves to next round', inline: true }
        )
        .setTimestamp();

      await channel.send({ embeds: [victoryEmbed] });
      await delay(MESSAGE_DELAY_MS);
    }

    remainingPlayers = nextRound;
    round++;

    // Add delay between rounds
    if (remainingPlayers.length > 1) {
      const nextRoundEmbed = new EmbedBuilder()
        .setTitle('⏳ PREPARING NEXT ROUND...')
        .setColor(0xFFA500)
        .setDescription(`The battle continues in ${MESSAGE_DELAY_MS / 1000} seconds...`)
        .setTimestamp();
      await channel.send({ embeds: [nextRoundEmbed] });
      await delay(MESSAGE_DELAY_MS);
    }
  }

  // Champion announcement
  const champion = remainingPlayers[0];
  const championEmbed = new EmbedBuilder()
    .setTitle('👑 GRAND CHAMPION CROWNED! 👑')
    .setColor(0xFFD700)
    .setDescription(`# **${getPlayerName(champion)}**\n### *${champion.weapon}*`)
    .addFields(
      { name: '🏆 Victory', value: 'Has conquered all opponents and claimed the title of Ultimate Creator!', inline: true },
      { name: '⚔️ Battles Won', value: `${battleHistory.filter(b => b.winner === getPlayerName(champion) && !b.bye).length}`, inline: true }
    )
    .setImage('https://media.giphy.com/media/3o7abB06u9bNzA8LC8/giphy.gif')
    .setTimestamp();

  await channel.send({ embeds: [championEmbed] });
  await delay(MESSAGE_DELAY_MS);

  // Battle summary
  if (battleHistory.length > 0) {
    const summaryEmbed = new EmbedBuilder()
      .setTitle('📜 Battle Chronicle')
      .setColor(0x4B0082)
      .setDescription('Here\'s how the epic battles unfolded:')
      .setTimestamp();

    await channel.send({ embeds: [summaryEmbed] });
    await delay(MESSAGE_DELAY_MS / 2);

    const summaryText = battleHistory.map((b, idx) => `**${idx + 1}.** ${b.battle}\n🏆 Winner: ${b.winner}\n💭 ${b.reason}`).join('\n\n');

    if (summaryText.length <= 4000) {
      const battleDetailsEmbed = new EmbedBuilder()
        .setTitle('📜 Battle Details')
        .setColor(0x4B0082)
        .setDescription(summaryText)
        .setTimestamp();

      await channel.send({ embeds: [battleDetailsEmbed] });
    } else {
      for (const battle of battleHistory) {
        const battleDetailEmbed = new EmbedBuilder()
          .setTitle(`⚔️ Battle ${battleHistory.indexOf(battle) + 1}`)
          .setColor(0x4B0082)
          .setDescription(`**${battle.battle}**\n🏆 Winner: ${battle.winner}\n💭 ${battle.reason}`)
          .setTimestamp();

        await channel.send({ embeds: [battleDetailEmbed] });
        await delay(MESSAGE_DELAY_MS / 2);
      }
    }
  }
}

// Start voting phase
async function startVotingPhase(interaction, game) {
  game.phase = 'theme_vote';
  game.themeOptions = await generateAIThemes();
  
  const voteEmbed = new EmbedBuilder()
    .setTitle('🎨 THEME VOTING TIME! 🎨')
    .setColor(0xE67E22)
    .setDescription(`## Vote for the battle theme!\n\n**Players:** ${game.players.size}\n**Voting Time:** 60 seconds (or until all vote)\n**AI Generated Themes:**\n\n${game.themeOptions.map((theme, idx) => `**${idx + 1}.** ${theme}\n👥 Votes: ${[...game.themeVotes.values()].filter(v => v === idx).length}`).join('\n\n')}\n\nEach player gets ONE vote. Choose wisely!`)
    .setTimestamp();
  
  const voteButtons = new ActionRowBuilder().addComponents(
    ...game.themeOptions.map((theme, idx) => 
      new ButtonBuilder()
        .setCustomId(`vote_theme_${idx}`)
        .setLabel(theme.length > 80 ? theme.substring(0, 77) + '...' : theme)
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🎭')
    )
  );
  
  await interaction.followUp({
    embeds: [voteEmbed],
    components: [voteButtons]
  });
  
  // Function to check if all players have voted
  const checkAllVoted = () => {
    return game.themeVotes.size === game.players.size;
  };
  
  // Theme voting timer with early completion check
  const voteInterval = setInterval(async () => {
    if (checkAllVoted() && game.phase === 'theme_vote') {
      clearInterval(voteInterval);
      clearTimeout(voteTimeout);
      await finalizeTheme(interaction, game);
    }
  }, 1000);
  
  const voteTimeout = setTimeout(async () => {
    clearInterval(voteInterval);
    if (game.phase === 'theme_vote') {
      await finalizeTheme(interaction, game);
    }
  }, THEME_VOTE_MS);
}

// Finalize theme selection
async function finalizeTheme(interaction, game) {
  if (game.phase !== 'theme_vote') return;
  
  const voteCounts = [0, 1, 2].map(i => 
    [...game.themeVotes.values()].filter(v => v === i).length
  );
  const winnerIndex = voteCounts.indexOf(Math.max(...voteCounts));
  game.chosenTheme = game.themeOptions[winnerIndex] || game.themeOptions[0];
  game.phase = 'submit';
  game.submitStartTime = Date.now();
  
  const themeResultEmbed = new EmbedBuilder()
    .setTitle('🎭 THEME SELECTED! 🎭')
    .setColor(0x2ECC71)
    .setDescription(`## **${game.chosenTheme}**\n\nwon the vote with ${voteCounts[winnerIndex]} votes!\n\nPrepare your themed creations...\n\n🎯 **Remember:** Your creation should fit this theme to have the best chance of winning!`)
    .setTimestamp();
  
  await interaction.followUp({ embeds: [themeResultEmbed] });
  await delay(MESSAGE_DELAY_MS);
  
  const submitEmbed = new EmbedBuilder()
    .setTitle('⚔️ SUBMIT YOUR CREATION ⚔️')
    .setColor(0x3498DB)
    .setDescription(`## Theme: **${game.chosenTheme}**\n\n**⏰ Time:** 2 minutes\n**📝 Instructions:**\n• Create any weapon, creature, or concept\n• **Must fit the theme: ${game.chosenTheme}**\n• Be creative! Themed creations get bonus points!\n• ${geminiAvailable ? 'Gemini AI' : 'The creative engine'} will judge with humor and facts\n\n**How to submit:**\nClick the **"Submit Creation"** button below and enter your creation!\n\n🎯 *Players who don't submit will be eliminated*`)
    .setTimestamp();
  
  await interaction.followUp({
    embeds: [submitEmbed],
    components: [submitRow()]
  });
  
  // Initial status update
  await updateSubmissionStatus(interaction, game);
  
  // Set timer for auto-conclude
  game.submitTimer = setTimeout(() => concludeSubmission(interaction, game), SUBMIT_MS);
  
  // Update status every 10 seconds
  game.statusInterval = setInterval(() => {
    if (game.phase === 'submit' && !game.progressed) {
      updateSubmissionStatus(interaction, game);
    }
  }, 10000);
}

// Conclude submission phase
async function concludeSubmission(interaction, game) {
  if (game.progressed || !activeGames.has(interaction.guildId)) return;
  game.progressed = true;
  
  // Clear status interval
  if (game.statusInterval) clearInterval(game.statusInterval);
  
  const validPlayers = [...game.players.values()].filter(p => p.weapon);
  
  if (validPlayers.length < 2) {
    const errorEmbed = new EmbedBuilder()
      .setTitle('❌ Battle Cancelled')
      .setDescription(`Not enough submissions! Only ${validPlayers.length}/${game.players.size} players submitted creations.\nNeed at least 2 players to battle.`)
      .setColor(0xFF0000);
    
    await interaction.followUp({ embeds: [errorEmbed] });
    activeGames.delete(interaction.guildId);
    return;
  }
  
  // Delete status message if it exists
  if (game.statusMessage) {
    await game.statusMessage.delete().catch(console.error);
  }
  
  // Announce submission phase complete
  const completeEmbed = new EmbedBuilder()
    .setTitle('✅ SUBMISSION PHASE COMPLETE!')
    .setColor(0x00FF00)
    .setDescription(`All ${validPlayers.length} players have submitted their creations!\n\nThe tournament will now begin...`)
    .setTimestamp();
  
  await interaction.followUp({ embeds: [completeEmbed] });
  await delay(MESSAGE_DELAY_MS);
  
  await runTournament(interaction.channel, validPlayers, game.chosenTheme);
  
  activeGames.delete(interaction.guildId);
}

// Event Handlers
client.once(Events.ClientReady, async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  
  // Initialize Gemini on startup
  if (process.env.GEMINI_API_KEY) {
    await initializeGeminiModel();
  }
  
  console.log('🎮 Clash of Creations Bot is ready!');
  if (geminiAvailable) {
    console.log('🤖 Using Google Gemini AI for themes and battle judging');
  } else {
    console.log('⚙️ Using fallback mode (no AI) - Add GEMINI_API_KEY for AI features');
    console.log('📝 Get a free Gemini API key: https://makersuite.google.com/app/apikey');
  }
});

client.on(Events.InteractionCreate, async interaction => {
  // Handle Slash Command
  if (interaction.isChatInputCommand() && interaction.commandName === 'clash_br') {
    if (activeGames.has(interaction.guildId)) {
      return interaction.reply({
        content: '❌ A battle is already raging in this server! Wait for it to finish.',
        ephemeral: true
      });
    }
    
    await interaction.deferReply();
    
    const themed = interaction.options.getString('themed') === 'true';
    const hostId = interaction.user.id;
    
    const game = {
      phase: 'join',
      themed,
      players: new Collection(),
      themeOptions: [],
      themeVotes: new Collection(),
      chosenTheme: null,
      hostInteraction: interaction,
      hostId: hostId,
      submitTimer: null,
      statusInterval: null,
      statusMessage: null,
      submitStartTime: null,
      progressed: false,
      guildId: interaction.guildId,
      channelId: interaction.channelId
    };
    
    activeGames.set(interaction.guildId, game);
    
    const joinEmbed = new EmbedBuilder()
      .setTitle('🎮 CLASH OF CREATIONS BATTLE ROYALE 🎮')
      .setColor(0x9B59B6)
      .setDescription(`## ⚔️ A new battle is forming!\n\n**Status:** 🟢 Waiting for warriors...\n**Theme:** ${themed ? '🎨 To be voted on' : '⚡ Open Battle'}\n**Minimum Players:** 3\n**Host:** <@${hostId}>\n**AI Judge:** ${geminiAvailable ? 'Gemini AI' : 'Creative Engine'}\n\n👥 **Current Players (${game.players.size}):**\n${game.players.size > 0 ? [...game.players.values()].map(p => `🎮 ${p.user.displayName}`).join('\n') : '🤔 No one has joined yet...'}\n\n**Click the button below to join the battle!**\n\nThe host can start the game once enough players have joined.`)
      .setTimestamp();
    
    await interaction.editReply({
      embeds: [joinEmbed],
      components: [joinRow(), startGameRow()]
    });
  }
  
  // Handle Buttons
  if (interaction.isButton()) {
    const game = activeGames.get(interaction.guildId);
    
    if (!game) {
      return interaction.reply({ content: '❌ No active game in this server.', ephemeral: true });
    }
    
    // Join button - ALWAYS AVAILABLE during join phase
    if (interaction.customId === 'join_clash') {
      if (game.phase !== 'join') {
        return interaction.reply({ content: '❌ Join phase is over!', ephemeral: true });
      }
      if (game.players.has(interaction.user.id)) {
        return interaction.reply({ content: '❌ You already joined!', ephemeral: true });
      }
      
      game.players.set(interaction.user.id, { 
        user: interaction.user, 
        weapon: null,
        displayName: interaction.user.displayName
      });
      
      await interaction.reply({ content: '✅ You have joined the battle!', ephemeral: true });
      
      // Update join message
      const updatedEmbed = new EmbedBuilder()
        .setTitle('🎮 CLASH OF CREATIONS BATTLE ROYALE 🎮')
        .setColor(0x9B59B6)
        .setDescription(`## ⚔️ A new battle is forming!\n\n**Status:** 🟢 Waiting for warriors...\n**Theme:** ${game.themed ? '🎨 To be voted on' : '⚡ Open Battle'}\n**Minimum Players:** 3\n**Host:** <@${game.hostId}>\n**AI Judge:** ${geminiAvailable ? 'Supreme Leader' : 'Creative Engine'}\n\n👥 **Current Players (${game.players.size}):**\n${game.players.size > 0 ? [...game.players.values()].map(p => `🎮 ${p.displayName}`).join('\n') : '🤔 No one has joined yet...'}\n\n**Click the button below to join the battle!**\n\nThe host can start the game once enough players have joined.`)
        .setTimestamp();
      
      // Enable start button if enough players
      const startDisabled = game.players.size < 2;
      
      await game.hostInteraction.editReply({
        embeds: [updatedEmbed],
        components: [joinRow(), startGameRow(startDisabled)]
      });
      
      return;
    }
    
    // Start button - ONLY HOST CAN USE
    if (interaction.customId === 'start_game') {
      if (game.phase !== 'join') {
        return interaction.reply({ content: '❌ Game has already started!', ephemeral: true });
      }
      
      if (interaction.user.id !== game.hostId) {
        return interaction.reply({ content: '❌ Only the host can start the game!', ephemeral: true });
      }
      
      if (game.players.size < 2) {
        return interaction.reply({ content: `❌ Need at least 2 players to start! Currently: ${game.players.size}/2`, ephemeral: true });
      }
      
      await interaction.reply({ content: '🚀 Starting the game!', ephemeral: true });
      
      // Disable start button and join button
      const disabledJoinRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('join_clash')
          .setLabel('⚔️ Join Battle')
          .setStyle(ButtonStyle.Success)
          .setEmoji('🎮')
          .setDisabled(true)
      );
      
      const disabledStartRow = startGameRow(true);
      
      await game.hostInteraction.editReply({
        components: [disabledJoinRow, disabledStartRow]
      });
      
      if (game.themed) {
        await startVotingPhase(game.hostInteraction, game);
      } else {
        // No theme mode
        game.phase = 'submit';
        game.chosenTheme = 'Open Battle';
        game.submitStartTime = Date.now();
        
        const submitEmbed = new EmbedBuilder()
          .setTitle('⚔️ SUBMIT YOUR CREATION ⚔️')
          .setColor(0x3498DB)
          .setDescription(`## Theme: **Open Battle**\n\n**⏰ Time:** 2 minutes\n**📝 Instructions:**\n• Create any weapon, creature, or concept\n• Anything goes! Let your imagination run wild\n• The judge will consider creativity and humor\n• ${geminiAvailable ? 'Gemini AI' : 'The creative engine'} will decide epic winners\n\n**How to submit:**\nClick the **"Submit Creation"** button below!\n\n🎯 *Players who don't submit will be eliminated*`)
          .setTimestamp();
        
        await game.hostInteraction.followUp({
          embeds: [submitEmbed],
          components: [submitRow()]
        });
        
        // Initial status update
        await updateSubmissionStatus(game.hostInteraction, game);
        
        game.submitTimer = setTimeout(() => concludeSubmission(game.hostInteraction, game), SUBMIT_MS);
        
        // Update status every 10 seconds
        game.statusInterval = setInterval(() => {
          if (game.phase === 'submit' && !game.progressed) {
            updateSubmissionStatus(game.hostInteraction, game);
          }
        }, 10000);
      }
      
      return;
    }
    
    // Vote button - ALLOW ALL PLAYERS TO VOTE
    if (interaction.customId.startsWith('vote_theme_')) {
      if (game.phase !== 'theme_vote') {
        return interaction.reply({ content: '❌ Theme voting is over!', ephemeral: true });
      }
      if (!game.players.has(interaction.user.id)) {
        return interaction.reply({ content: '❌ Only players who joined can vote!', ephemeral: true });
      }
      if (game.themeVotes.has(interaction.user.id)) {
        return interaction.reply({ content: '❌ You already voted!', ephemeral: true });
      }
      
      const voteIndex = parseInt(interaction.customId.split('_').pop());
      game.themeVotes.set(interaction.user.id, voteIndex);
      
      await interaction.reply({ 
        content: `✅ You voted for **${game.themeOptions[voteIndex]}**`,
        ephemeral: true 
      });
      
      // Update vote embed WITHOUT disabling buttons
      const updatedVoteEmbed = new EmbedBuilder()
        .setTitle('🎨 THEME VOTING TIME! 🎨')
        .setColor(0xE67E22)
        .setDescription(`## Vote for the battle theme!\n\n**Players:** ${game.players.size}\n**Votes Cast:** ${game.themeVotes.size}\n**Voting Time:** ${THEME_VOTE_MS / 1000} seconds (or until all vote)\n\n${game.themeOptions.map((theme, idx) => `**${idx + 1}.** ${theme}\n👥 Votes: ${[...game.themeVotes.values()].filter(v => v === idx).length}`).join('\n\n')}\n\nEach player gets ONE vote. Choose wisely!`)
        .setTimestamp();
      
      // Keep buttons enabled for other players to vote
      const voteButtons = new ActionRowBuilder().addComponents(
        ...game.themeOptions.map((theme, idx) => 
          new ButtonBuilder()
            .setCustomId(`vote_theme_${idx}`)
            .setLabel(theme.length > 80 ? theme.substring(0, 77) + '...' : theme)
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🎭')
        )
      );
      
      await interaction.message.edit({
        embeds: [updatedVoteEmbed],
        components: [voteButtons]
      });
      
      return;
    }
    
    // Submit button - ALLOW ALL PLAYERS TO SUBMIT
    if (interaction.customId === 'submit_weapon_open') {
      if (game.phase !== 'submit') {
        return interaction.reply({ content: '❌ Submission phase is over!', ephemeral: true });
      }
      const player = game.players.get(interaction.user.id);
      if (!player) {
        return interaction.reply({ content: '❌ You are not in this battle!', ephemeral: true });
      }
      if (player.weapon) {
        return interaction.reply({ content: '❌ You already submitted your creation!', ephemeral: true });
      }
      
      const modal = new ModalBuilder()
        .setCustomId('submit_weapon')
        .setTitle('⚔️ Submit Your Creation ⚔️');
      
      // Fixed: Shorter placeholder text to avoid character limit
      const input = new TextInputBuilder()
        .setCustomId('weapon')
        .setLabel(game.chosenTheme ? `Your ${game.chosenTheme.substring(0, 45)} Creation` : 'Your Battle Creation')
        .setPlaceholder('Quantum Dragon, Void Blade, Sonic Cannon...')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(200);
      
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      
      return interaction.showModal(modal);
    }
  }
  
  // Handle Modal Submit
  if (interaction.isModalSubmit() && interaction.customId === 'submit_weapon') {
    const game = activeGames.get(interaction.guildId);
    if (!game || game.phase !== 'submit') {
      return interaction.reply({ content: '❌ Submission window closed!', ephemeral: true });
    }
    
    const player = game.players.get(interaction.user.id);
    if (!player || player.weapon) {
      return interaction.reply({ content: '❌ Already submitted or not in game!', ephemeral: true });
    }
    
    const weapon = interaction.fields.getTextInputValue('weapon');
    player.weapon = weapon;
    
    await interaction.reply({ 
      content: `✅ Your creation has been entered into the battle!`,
      ephemeral: true 
    });
    
    const submittedCount = [...game.players.values()].filter(p => p.weapon).length;
    const totalPlayers = game.players.size;
    
    // Update the status message
    await updateSubmissionStatus(game.hostInteraction, game);
    
    if (submittedCount === totalPlayers && !game.progressed) {
      if (game.submitTimer) clearTimeout(game.submitTimer);
      await concludeSubmission(game.hostInteraction, game);
    }
  }
});

// Startup
(async () => {
  try {
    await deployCommands();
    
    if (!process.env.GEMINI_API_KEY) {
      console.warn('⚠️ GEMINI_API_KEY not set. The bot will use creative fallback logic for themes and battles.');
      console.warn('⚠️ For best experience, get a free Gemini API key from: https://makersuite.google.com/app/apikey');
    } else {
      console.log('📡 Gemini API key found, initializing...');
    }
    
    await client.login(process.env.TOKEN);
    console.log('🎮 Bot is online and ready for battles!');
  } catch (error) {
    console.error('❌ Startup failed:', error.message);
    console.error('Required .env variables: TOKEN, CLIENT_ID (or APPLICATION_ID)');
    console.error('Optional: GUILD_ID, GEMINI_API_KEY (get free key from Google AI Studio)');
    process.exit(1);
  }
})();

const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const appId = process.env.CLIENT_ID || process.env.APPLICATION_ID;
const guildId = process.env.GUILD_ID;
const token = process.env.TOKEN;

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

if (!token) {
    throw new Error('Missing TOKEN in .env');
}

if (!appId) {
    throw new Error('Missing CLIENT_ID (or APPLICATION_ID) in .env');
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
    try {
        console.log('Deploying commands...');
        console.log(`Application ID: ${appId}`);

        if (guildId) {
            await rest.put(Routes.applicationGuildCommands(appId, guildId), {
                body: commands
            });

            console.log(`✅ Guild commands deployed to guild ${guildId}`);
            console.log('Tip: guild commands should appear almost instantly.');
        } else {
            await rest.put(Routes.applicationCommands(appId), {
                body: commands
            });

            console.log('✅ Global commands deployed.');
            console.log('Tip: global commands can take up to 1 hour to appear.');
        }
    } catch (err) {
        console.error('❌ Command deploy failed.');
        console.error(err.rawError || err);
        process.exitCode = 1;
    }
})();

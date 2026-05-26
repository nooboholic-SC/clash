const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

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

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log('Deploying commands...');

        await rest.put(
            Routes.applicationGuildCommands(
                process.env.CLIENT_ID,
                process.env.GUILD_ID
            ),
            { body: commands }
        );

        console.log('Commands deployed!');
    } catch (err) {
        console.error(err);
    }
})();

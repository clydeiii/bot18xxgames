// load .env file
require('dotenv').config();
const Discord = require('discord.js');
const client = new Discord.Client();
const timeUp = Date();

client.on('ready', () => {
	console.log(`Logged in as ${client.user.tag}!`);
});

client.on('message', msg => {
	if (msg.content === 'ping') {
		msg.reply('pong via @clydeiii#0966 (time up:' + timeUp + ')');
	}
});

client.login(process.env.DISCORD_TOKEN);

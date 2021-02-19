// load .env file for heroku
require('dotenv').config();
const Discord = require('discord.js');
const client = new Discord.Client();
const fetch = require('node-fetch');
const fs = require('fs');
const timeUp = Date();
const commandLogFileName = './commands.log';
const monitorCommand = '!monitor_game';
const listCommand = '!list_games';
const forgetCommand = '!forget_game';
const helpCommand = '!help';
const gameDatabase = new Discord.Collection();
const internalPollingInterval = 29;
const externalPollingInterval = 179;
const webAPI = 'https://www.18xx.games/api/game/';

class Game {
	constructor(id, players, channel, guild) {
		this._id = id;
		this._players = players.array();
		this._currentPlayer = players.first();
		this._channel = channel;
		this._guild = guild;
		this._needsAlert = false;
	}
	set id(val) {
		this._id = val;
	}
	get id() {
		return this._id;
	}
	set players(allPlayers) {
		this._players = allPlayers;
	}
	get players() {
		return this._players;
	}
	set currentPlayer(currentPlayer) {
		this._currentPlayer = currentPlayer;
	}
	get currentPlayer() {
		return this._currentPlayer;
	}
	set needsAlert(alertValue) {
		this._needsAlert = alertValue;
	}
	get needsAlert() {
		return this._needsAlert;
	}
	set guild(serverName) {
		this._guild = serverName;
	}
	get guild() {
		return this._guild;
	}
	set channel(channel) {
		this._channel = channel;
	}
	get channel() {
		return this._channel;
	}

	advancePlayer(nextPlayerAccordingToWeb) {
		// if the next player is different from the current player
		let realNextUser = this._currentPlayer;

		// we need to turn website's player name into discord player object here
		// loop over all assigned discord users into this game and see if any match exists
		for(const player of this._players) {
			if(player.username === nextPlayerAccordingToWeb) {
				realNextUser = player;
			}
		}
		// if there's a new current player, we need to notify them by setting needsAlert to true
		if(this._currentPlayer != realNextUser) {
			// we need to alert the next player that it's their turn
			console.log(`${nextPlayerAccordingToWeb}'s turn, time to notify them`);
			this._needsAlert = true;
		}
		this._currentPlayer = realNextUser;
	}

	toString() {
		return `game id ${this._id} with players ${this._players} in channel ${this._channel} on server ${this._guild}`;
	}
}

/** *****
 *
 * this is the "main" function
 *
 ****/
client.on('message', msg => {
	// console.log(msg.content);
	if (msg.content.startsWith(monitorCommand)) {
		fs.appendFileSync(commandLogFileName, `${msg.channel} ${msg.content}\n`);
		const args = msg.content.slice(monitorCommand.length).trim().split(' ');
		const gameID = args[0];
		if(!gameDatabase.has(gameID)) {
			gameDatabase.set(gameID, new Game(gameID, msg.mentions.users, msg.channel, msg.guild));
			console.log('monitoring game: ' + gameDatabase.get(gameID).toString());
			msg.reply(`monitoring game: ${gameDatabase.get(gameID).toString()}`);
		}
		else {
			console.log(`player tried to monitor game ${gameID} twice`);
			msg.reply(`alreadying monitoring game ${gameID}`);
		}
	}
	else if(msg.content.startsWith(forgetCommand)) {
		fs.appendFileSync(commandLogFileName, `${msg.channel} ${msg.content}\n`);
		const args = msg.content.slice(forgetCommand.length).trim().split(' ');
		const gameID = args[0];
		console.log('forgetting game ' + gameID);
		gameDatabase.delete(gameID);
		msg.reply(`game ${gameID} forgotten`);
	}
	else if (msg.content === listCommand) {
		for(const gameID of gameDatabase.keys()) {
			msg.reply(`${gameID} : ${gameDatabase.get(gameID).toString()}`);
		}
	}
	else if(msg.content === helpCommand) {
		msg.reply(`commands supported: \n${monitorCommand} [gameID] players\n${forgetCommand} [gameID]\n${listCommand}\n${helpCommand}`);
	}
	else if (msg.content === '!wwjcld') {
		msg.reply('clearclaw would dump B&O on you right now');
	}
});

// log that bot is up and online
client.once('ready', () => {
	console.log(`Logged in as ${client.user.tag} at uptime: ${timeUp}`);
});


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


/*
 * async function getCurrentPlayersFromWeb queries 18xx.games website via web API, given an game ID, then uses that update our internal database
 */
const getCurrentPlayerFromWeb = async gameID => {
	try {
		console.log(`obtaining active player from ${webAPI}${gameID}`);
		const response = await fetch(webAPI + gameID);
		const json = await response.json();
		const gameStatus = json.status;
		if(gameStatus === 'finished') {
			console.log(`game ${gameID} has finished`);
			gameDatabase.delete(gameID);
		}
		json.players.forEach(player => {
			if(player['id'] === parseInt(json.acting)) {
				console.log(`active player in ${gameID} is ${player['name']}`);
				const game = gameDatabase.get(gameID);
				game.advancePlayer(player['name']);
			}
		});
                await sleep(1000);
	}
	catch (error) {
		console.log(error);
	}
};

// inject bot token in real time from .env variable
client.login(process.env.DISCORD_TOKEN);

// start a background process that runs every 10 seconds and alerts any players whose turn it is
setInterval (function() {
	for(const gameID of gameDatabase.keys()) {
		const game = gameDatabase.get(gameID);
		if (game.needsAlert) {
			game.channel.send(`${game.currentPlayer} it is your turn in https://www.18xx.games/game/${gameID}`).catch(console.error);
			game.needsAlert = false;
		}
	}
}, internalPollingInterval * 1000);

// start background process that queries 18xx.games every n seconds
setInterval (function() {
	// loop over all games we know about and query web for each one
	for(const gameID of gameDatabase.keys()) {
		const game = gameDatabase.get(gameID);
		getCurrentPlayerFromWeb(game.id);
	}
}, externalPollingInterval * 1000);


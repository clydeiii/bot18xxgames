// load .env file for heroku
require('dotenv').config();
const Discord = require('discord.js');
const discordClient = new Discord.Client();
const pg = require('pg');
const fetch = require('node-fetch');
const fs = require('fs');
const timeUp = Date();
const commandLogFileName = './commands.log';
const monitorCommand = '!monitor_game';
const listCommand = '!list_games';
const forgetCommand = '!forget_game';
const usernameCommand = '!username';
const helpCommand = '!help';
const gameDatabase = new Discord.Collection();
const internalPollingInterval = 29;
const externalPollingInterval = 179;
const webAPI = 'https://www.18xx.games/api/game/';

const pgClient = new pg.Client({
	connectionString: process.env.DATABASE_URL,
	ssl: {
		rejectUnauthorized: false
	}
});
pgClient.connect();

const playerUsernameMap = new Map();

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
			if (playerEquals(player, nextPlayerAccordingToWeb)) {
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

function playerEquals(player, name) {
	if (playerUsernameMap.has(player.id) && playerUsernameMap.get(player.id) === name) {
		return true;
	}
	if (player.nickname && player.nickname === name) {
		return true;
	}
	return player.user.username === name;
}

function initGames() {
	pgClient.query('SELECT id, game_id, guild_id, channel_id FROM game WHERE is_active').then((res) => {
		for (let row of res.rows) {
			pgClient.query('SELECT user_id FROM player WHERE game_id = $1', [row.id]).then((playerRes) => {
				initGame(row.game_id, row.guild_id, row.channel_id, playerRes.rows.map(playerRow => playerRow.user_id));
			}).catch(err => {
				console.error(`Failed to look up game ${row.id}: ${err.stack}`);
			})
		}
	}).catch(err => {
		console.error(`Failed to look up list of games: ${err.stack}`);
	});
}

function initGame(gameId, guildId, channelId, playerIds) {
	if (!gameDatabase.has(gameId)) {
		const guild = discordClient.guilds.cache.get(guildId);
		const channel = guild.channels.cache.get(channelId);
		const playersPromise = guild.members.fetch({user: playerIds});
		playersPromise.then((players) => {
			gameDatabase.set(gameId, new Game(gameId, players, channel, guild));
			console.log('loaded game: ' + gameDatabase.get(gameId).toString());
		});
	} else {
		console.warn(`tried to load game ${gameId} but it already exists`);
	}
}

function insertGame(game) {
	pgClient.query('BEGIN').then(res => {
		return pgClient.query('INSERT INTO game(game_id, guild_id, channel_id) VALUES ($1, $2, $3) RETURNING id', [game.id, game.guild.id, game.channel.id])
			.then((res) => {
			const id = res.rows[0].id;
			const insertPromises = [];
			for (let player of game.players) {
				insertPromises.push(pgClient.query('INSERT INTO player(game_id, user_id) VALUES ($1, $2)', [id, player.id]));
			}
			return Promise.all(insertPromises).then((res) => pgClient.query('COMMIT'));
		})
	}).catch((err) => {
		console.error(err.stack);
		pgClient.query('ROLLBACK');
	});
}

function deleteGame(gameId) {
	pgClient.query('DELETE FROM game WHERE game_id = $1', [gameId]);
}

function updateGameFinished(gameId) {
	pgClient.query('UPDATE game SET is_active = false WHERE game_id = $1', [gameId]);
}

async function initUsernameMap() {
	const res = await pgClient.query('SELECT discord_user_id, web_username FROM username_map');
	for (const row of res.rows) {
		playerUsernameMap.set(row.discord_user_id, row.web_username);
	}
}

function insertOrUpdateUsername(discordId, username) {
	pgClient.query('INSERT INTO username_map (discord_user_id, web_username) VALUES ($1, $2) '
		+ 'ON CONFLICT (discord_user_id) DO UPDATE SET web_username = $2', [discordId, username])
}

/** *****
 *
 * this is the "main" function
 *
 ****/
discordClient.on('message', msg => {
	// console.log(msg.content);
	if (msg.content.startsWith(monitorCommand)) {
		fs.appendFileSync(commandLogFileName, `${msg.channel} ${msg.content}\n`);
		const args = msg.content.slice(monitorCommand.length).trim().split(' ');
		const gameID = args[0];
		if(!gameDatabase.has(gameID)) {
			gameDatabase.set(gameID, new Game(gameID, msg.mentions.members, msg.channel, msg.guild));
			insertGame(gameDatabase.get(gameID));
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
		deleteGame(gameID);
		msg.reply(`game ${gameID} forgotten`);
	}
	else if (msg.content === listCommand) {
		for(const gameID of gameDatabase.keys()) {
			msg.reply(`${gameID} : ${gameDatabase.get(gameID).toString()}`);
		}
	}
	else if (msg.content.startsWith(usernameCommand)) {
		const username = msg.content.slice(usernameCommand.length).trim();
		playerUsernameMap.set(msg.author.id, username);
		insertOrUpdateUsername(msg.author.id, username);
		msg.reply(`recorded your 18xx.games username as ${username}`);
	}
	else if(msg.content === helpCommand) {
		msg.reply(`commands supported: \n${monitorCommand} gameID @player1 @player2 @player3 @etc\n${forgetCommand} gameID\n${listCommand}\n${helpCommand}`);
	}
	else if (msg.content === '!wwjcld') {
		msg.reply('clearclaw would dump B&O on you right now');
	}
});

// log that bot is up and online
discordClient.once('ready', () => {
	console.log(`Logged in as ${discordClient.user.tag} at uptime: ${timeUp}`);
	initGames();
	initUsernameMap();
});

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
			updateGameFinished(gameID);
		}
		json.players.forEach(player => {
			if(player['id'] === parseInt(json.acting)) {
				console.log(`active player in ${gameID} is ${player['name']}`);
				const game = gameDatabase.get(gameID);
				game.advancePlayer(player['name']);
			}
		});
	}
	catch (error) {
		console.log(error);
	}
};

// inject bot token in real time from .env variable
discordClient.login(process.env.DISCORD_TOKEN);

// start a background process that runs every 10 seconds and alerts any players whose turn it is
setInterval (function() {
	for(const gameID of gameDatabase.keys()) {
		const game = gameDatabase.get(gameID);
		if (game.needsAlert) {
			let updateMsg = `${game.currentPlayer} it is your turn in https://www.18xx.games/game/${gameID}`;
			if (process.env.UPDATE_MSG) {
				updateMsg = updateMsg + `\n${process.env.UPDATE_MSG}`;
			}
			game.channel.send(updateMsg).catch(console.error);
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


#!/bin/env node
//  OpenShift sample Node application
var express = require('express');
var fs      = require('fs');

var cuRestAPI = require('./cu-rest.js');
var config = require('./cu-chatbot.cfg');

if (typeof Promise === 'undefined') Promise = require('bluebird');

// function to read in the saved game stats
function getGameStats(server) {
    return new Promise(function (fulfill, reject) {
        fs.readFile(server.gameFile, function(err, data) {
            if (err && err.code === 'ENOENT') {
                var gameStats = {
                    firstGame: Math.floor((new Date).getTime() / 1000),
                    gameNumber: 0,
                    lastStartTime: 0,
                    artWins: 0,
                    tuaWins: 0,
                    vikWins: 0
                };

                fs.writeFile(server.gameFile, JSON.stringify(gameStats), function(err) {
                    if (err) {
                        reject("[ERROR] Unable to create game stats file.");
                    }
                    console.log("[STATUS] Game stats file did not exist. Empty file created.");
                });
            } else {
                var gameStats = JSON.parse(data);
            }
            fulfill(gameStats);
        });
    });
}

// function to read in the saved player stats
function getPlayerStats(server) {
    return new Promise(function (fulfill, reject) {
        fs.readFile(server.playerFile, function(err, data) {
            if (err && err.code === 'ENOENT') {
                var playerStats = [];

                fs.writeFile(server.playerFile, JSON.stringify(playerStats), function(err) {
                    if (err) {
                        reject("[ERROR] Unable to create player stats file.");
                    }
                    console.log("[STATUS] Player stats file did not exist. Empty file created.");
                });
            } else {
                var playerStats = JSON.parse(data);
            }
            fulfill(playerStats);
        });
    });
}

// function to read in the saved server online stats
function getOnlineStats(server) {
    return new Promise(function (fulfill, reject) {
        fs.readFile(server.onlineFile, function(err, data) {
            if (err && err.code === 'ENOENT') {
                var onlineStats = {
                    name: server.name,
                    lastNotice: 0,
                    online: false,
                    accessLevel: 6
                };

                fs.writeFile(server.onlineFile, JSON.stringify(onlineStats[server.name]), function(err) {
                    if (err) {
                        return util.log("[ERROR] Unable to create server online stats file.");
                    }
                    util.log("[STATUS] Server online stats file did not exist. Empty file created.");
                });
            } else {
                var onlineStats = JSON.parse(data);
            }
            fulfill(onlineStats);
        });
    });
}

function queue(count, callback) {
    this.signal = function() {
        if (--count < 1) callback();
    };
}

/**
 *  Define the sample application.
 */
var SampleApp = function() {

    //  Scope.
    var self = this;


    /*  ================================================================  */
    /*  Helper functions.                                                 */
    /*  ================================================================  */

    /**
     *  Set up server IP address and port # using env variables/defaults.
     */
    self.setupVariables = function() {
        //  Set the environment variables we need.
        // self.ipaddress = process.env.OPENSHIFT_NODEJS_IP;
        // self.port      = process.env.OPENSHIFT_NODEJS_PORT || 8080;
        self.ipaddress = '0.0.0.0';
        self.port = 8080;


        if (typeof self.ipaddress === "undefined") {
            //  Log errors on OpenShift but continue w/ 127.0.0.1 - this
            //  allows us to run/test the app locally.
            console.warn('No OPENSHIFT_NODEJS_IP var, using 127.0.0.1');
            self.ipaddress = "127.0.0.1";
            // self.ipaddress = "192.168.1.101";

        };
    };


    /**
     *  Populate the cache.
     */
    self.populateCache = function() {
        if (typeof self.zcache === "undefined") {
            self.zcache = { 'index.html': '' };
        }

        //  Local cache for static content.
        self.zcache['index.html'] = fs.readFileSync('./index.html');
    };


    /**
     *  Retrieve entry (content) from cache.
     *  @param {string} key  Key identifying content to retrieve from cache.
     */
    self.cache_get = function(key) { return self.zcache[key]; };


    /**
     *  terminator === the termination handler
     *  Terminate server on receipt of the specified signal.
     *  @param {string} sig  Signal to terminate on.
     */
    self.terminator = function(sig){
        if (typeof sig === "string") {
           console.log('%s: Received %s - terminating sample app ...',
                       Date(Date.now()), sig);
           n.kill();
           process.exit(1);
        }
        console.log('%s: Node server stopped.', Date(Date.now()) );
    };


    /**
     *  Setup termination handlers (for exit and a list of signals).
     */
    self.setupTerminationHandlers = function(){
        //  Process on exit and signals.
        process.on('exit', function() { self.terminator(); });

        // Removed 'SIGPIPE' from the list - bugz 852598.
        ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT',
         'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'
        ].forEach(function(element, index, array) {
            process.on(element, function() { self.terminator(element); });
        });
    };


    /*  ================================================================  */
    /*  App server functions (main app logic here).                       */
    /*  ================================================================  */

    /**
     *  Create the routing table entries + handlers for the application.
     */
    self.createRoutes = function() {
        self.routes = { };

        self.routes['/'] = function(req, res) {
            var server = {};
            pageContent = "";
            serversReady = 0;
            config.servers.forEach(function(s, index) {
                server[s.name] = s;
                server[s.name].rAPI = new cuRestAPI(s.name);

                var resultQueue = new queue(4, function() {
                    // Build final page to display.
                    server[s.name].pageContent =
                            '<tr><td colspan="3"><center><p class="serverTitle">' + s.name.charAt(0).toUpperCase() + s.name.slice(1) + '</p></center></td></tr><tr>' +
                            '<td valign="top" width="36%" bgcolor="#606060" style="border-style:groove; border-color:#C0C0C0"><center><table width="100%">' +
                                '<tr><td bgcolor="#F3E2A9"><center><p class="sectionTitle">Current Score</p></center></td></tr>' +
                                '<tr><td>' + server[s.name].score + '</td></tr>' +
                            '</table></center></td>' +
                            '<td valign="top" width="28%" bgcolor="#606060" style="border-style:groove; border-color:#C0C0C0"><center><table width="100%">' +
                                '<tr><td bgcolor="#F3E2A9"><center><p class="sectionTitle">Current Players</p></center></td></tr>' +
                                '<tr><td>' + server[s.name].players + '</td></tr>' +
                            '</table></center></td>' +
                            '<td valign="top" width="36%" bgcolor="#606060" style="border-style:groove; border-color:#C0C0C0"><center><table width="100%">' +
                                '<tr><td bgcolor="#F3E2A9"><center><p class="sectionTitle">Realm History</p></center></td></tr>' +
                                '<tr><td>' + server[s.name].wins + '</td></tr>' +
                            '</table></center></td></tr>' +
                            '<tr><td colspan="3" valign="top" bgcolor="#606060" style="border-style:groove; border-color:#C0C0C0"><center><table width="100%">' +
                                '<tr><td bgcolor="#F3E2A9"><center><p class="sectionTitle">Leaderboard</p></center></td></tr>' +
                                '<tr><td>' + server[s.name].leaderboard + '</td></tr>' +
                            '</table></center></td></tr>';

                    serversReady++;
                    if (serversReady === config.servers.length) {
                        for (i = 0; i < config.servers.length; i++) {
                            pageContent += server[config.servers[i].name].pageContent;
                        }
                        res.setHeader('Content-Type', 'text/html');
                        res.send(self.cache_get('index.html').toString().replace('##PAGECONTENT##', pageContent));
                    }
                });

                server[s.name].rAPI.getControlGame().then(function(data) {
                    // Build current game score section.
                    var artScore = data.arthurianScore;
                    var tuaScore = data.tuathaDeDanannScore;
                    var vikScore = data.vikingScore;
                    var timeLeft = data.timeLeft;
                    var minLeft = Math.floor(timeLeft / 60);
                    var secLeft = Math.floor(timeLeft % 60);
                    if (data.gameState === 0) {
                        var gameState = "Disabled"
                    } else if (data.gameState === 1) {
                        var gameState = "Waiting For Next Round";
                    } else if (data.gameState === 2) {
                        var gameState = "Basic Game Active";
                    } else if (data.gameState === 3) {
                        var gameState = "Advanced Game Active";
                    }

                    server[s.name].score = '<b>Game State:</b> ' + gameState +
                        '<br /><b>Time Remaining:</b> ' + minLeft + ' min. ' + secLeft + ' sec.<br />' +
                        '<br /><img src="/images/shield-arthurians.png" width="25" align="center" />&nbsp; <b>Arthurian Score:</b> ' + artScore +
                        '<br /><img src="/images/shield-tdd.png" width="25" align="center" />&nbsp; <b>TuathaDeDanann Score:</b> ' + tuaScore +
                        '<br /><img src="/images/shield-vikings.png" width="25" align="center" />&nbsp; <b>Viking Score:</b> ' + vikScore;
                    resultQueue.signal();
                }, function(error) {
                    server[s.name].score = '<p style="color: #610B0B; margin-top: 1px; margin-bottom: 1px; margin-left: 1px; margin-right: 1px;">Error accessing API. Server may be down.</p>';
                    resultQueue.signal();
                });

                server[s.name].rAPI.getPlayers().then(function(data) {
                    // Store player data to be used in next section.
                    var players = data;
                    var accessLevel = "Unknown";
                    var artPlayers = players.arthurians;
                    var tuaPlayers = players.tuathaDeDanann;
                    var vikPlayers = players.vikings;
                    var totalPlayers = players.arthurians + players.tuathaDeDanann + players.vikings;

                    getOnlineStats(server[s.name]).then(function(data) {
                        switch(data.accessLevel) {
                            case 0:
                                accessLevel = "Public";
                                break;
                            case 1:
                                accessLevel = "Beta 3";
                                break;
                            case 2:
                                accessLevel = "Beta 2";
                                break;
                            case 3:
                                accessLevel = "Beta 1";
                                break;
                            case 4:
                                accessLevel = "Alpha";
                                break;
                            case 5:
                                accessLevel = "IT";
                                break;
                            case 6:
                                accessLevel = "Development";
                                break;
                            default:
                                accessLevel = "Unknown";
                        }

                        // Build current player count section.
                        server[s.name].players = '<b>Current Player Count:</b> ' + totalPlayers +
                            '<br /><b>Player Type Allowed:</b> ' + accessLevel + '<br />' +
                            '<br /><img src="/images/shield-arthurians.png" width="25" align="center" />&nbsp; <b>Arthurians:</b> ' + artPlayers +
                            '<br /><img src="/images/shield-tdd.png" width="25" align="center" />&nbsp; <b>TuathaDeDanann:</b> ' + tuaPlayers +
                            '<br /><img src="/images/shield-vikings.png" width="25" align="center" />&nbsp; <b>Vikings:</b> ' + vikPlayers;
                            resultQueue.signal();
                    }, function(error) {
                        // Build current player count section.
                        server[s.name].players = '<b>Current Player Count:</b> ' + totalPlayers +
                            '<br /><img src="/images/shield-arthurians.png" width="25" align="center" />&nbsp; <b>Arthurians:</b> ' + artPlayers +
                            '<br /><img src="/images/shield-tdd.png" width="25" align="center" />&nbsp; <b>TuathaDeDanann:</b> ' + tuaPlayers +
                            '<br /><img src="/images/shield-vikings.png" width="25" align="center" />&nbsp; <b>Vikings:</b> ' + vikPlayers;
                            resultQueue.signal();
                    });
                }, function(error) {
                    server[s.name].players = '<p style="color: #610B0B; margin-top: 1px; margin-bottom: 1px; margin-left: 1px; margin-right: 1px;">Error accessing API. Server may be down.</p>';
                    resultQueue.signal();
                });

                getGameStats(server[s.name]).then(function(data) {
                    // Build total game statistics section.
                    server[s.name].wins = '<b>Total Rounds Played:</b> ' + data.gameNumber + '<br />&nbsp;<br />' +
                        '<br /><img src="/images/shield-arthurians.png" width="25" align="center" />&nbsp; <b>Arthurian Wins:</b> ' + data.artWins +
                        '<br /><img src="/images/shield-tdd.png" width="25" align="center" />&nbsp; <b>TuathaDeDanann Wins:</b> ' + data.tuaWins +
                        '<br /><img src="/images/shield-vikings.png" width="25" align="center" />&nbsp; <b>Viking Wins:</b> ' + data.vikWins;
                    resultQueue.signal();
                }, function(error) {
                    server[s.name].wins = '<p style="color: #610B0B; margin-top: 1px; margin-bottom: 1px; margin-left: 1px; margin-right: 1px;">Error reading game statistics.</p>';
                    resultQueue.signal();
                });

                getPlayerStats(server[s.name]).then(function(data) {
                    // Build leaderboard section.

                    // Remove bots from rankings.
                    for (var i = 0; i < data.length; i++) {
                        if (config.botNames.indexOf(data[i].playerName) > -1) {
                            data.splice(i, 1);
                            i--;
                        }
                    }

                    // Ensure at least 10 entries exist. Create dummy entries if not.
                    for (var i = 0; i < 10; i++) {
                        if (! data[i]) data[i] = {
                            playerName: 'Nobody',
                            playerFaction: 'None',
                            playerRace: 'None',
                            playerType: 'None',
                            kills: 0,
                            deaths: 0,
                            gamesPlayed: 0
                        };
                    }

                    var playersSortedByKills = data.concat().sort(function(a, b) { return b.kills - a.kills; });
                    var playersSortedByDeaths = data.concat().sort(function(a, b) { return b.deaths - a.deaths; });

                    server[s.name].leaderboard = '<center><table width="95%" style="border-collapse: collapse;">' +
                        '<tr><td colspan="3" width="50%" class="leaderBoardTitle"><center><p class="leaderBoardTitle"><a style="color: inherit;" href="/kills/'+ s.name + '/">Kills</a></p></center></td><td>&nbsp;</td><td colspan="3" width="50%" class="leaderBoardTitle"><center><p class="leaderBoardTitle"><a style="color: inherit;" href="/deaths/'+ s.name + '/">Deaths</a></p></center></td></tr>';
                    for (var i = 0; i < 10; i++) {
                        server[s.name].leaderboard = server[s.name].leaderboard +
                            '<tr><td width="3%" class="leaderBoardLine1L"><b>#' + (i + 1) + '</b></td><td width="33%" class="leaderBoardLine1M"><a style="color: inherit;" href="/player/' + s.name + '/' + playersSortedByKills[i].playerName + '/">' + playersSortedByKills[i].playerName + '</a> (' + playersSortedByKills[i].playerRace + ') </td><td width="10%" align="right" class="leaderBoardLine1R">' + playersSortedByKills[i].kills + '</td>' +
                            '<td>&nbsp;</td><td width="3%" class="leaderBoardLine1L"><b>#' + (i + 1) + '</b></td><td width="33%" class="leaderBoardLine1M"><a style="color: inherit;" href="/player/' + s.name + '/' + playersSortedByDeaths[i].playerName + '/">' + playersSortedByDeaths[i].playerName + '</a> (' + playersSortedByDeaths[i].playerRace + ') </td><td width="10%" align="right" class="leaderBoardLine1R">' + playersSortedByDeaths[i].deaths + '</td></tr>'
                    }
                    server[s.name].leaderboard = server[s.name].leaderboard + '</table></center>';
                    resultQueue.signal();
                }, function(error) {
                    server[s.name].leaderboard = '<p style="color: #610B0B; margin-top: 1px; margin-bottom: 1px; margin-left: 1px; margin-right: 1px;">Error reading player statistics.</p>';
                    resultQueue.signal();
                });
            });
        };

        self.routes['/kills/:server'] = function(req, res) {
            var serverName = req.params.server;
            var pageContent = "";

            for (var i = 0; i < config.servers.length; i++) {
                if (config.servers[i].name === serverName) {
                    var server = config.servers[i];
                }
            }

            if (typeof server === 'undefined') {
                pageContent = '<tr><td><center><p class="serverTitle">' + serverName.charAt(0).toUpperCase() + serverName.slice(1) + '</p></center></td></tr>' +
                    '<tr><td valign="top" bgcolor="#606060" style="border-style:groove; border-color:#C0C0C0"><center><table width="100%">' +
                    '<tr><td bgcolor="#F3E2A9"><center><p class="sectionTitle">Player Kill Count</p></center></td></tr>' +
                    '<tr><td> A server named ' + serverName + ' does not exist.</td></tr></table></center></td></tr>';
                res.setHeader('Content-Type', 'text/html');
                res.send(self.cache_get('index.html').toString().replace('##PAGECONTENT##', pageContent));
            } else {
                pageContent = '<tr><td><center><p class="serverTitle">' + server.name.charAt(0).toUpperCase() + server.name.slice(1) + '</p></center></td></tr>' +
                    '<tr><td valign="top" bgcolor="#606060" style="border-style:groove; border-color:#C0C0C0"><center><table width="100%">' +
                    '<tr><td bgcolor="#F3E2A9"><center><p class="sectionTitle">Player Kill Count</p></center></td></tr>' +
                    '<tr><td>';

                getPlayerStats(server).then(function(ps) {
                    var totalKills = 0;
                    var totalPlayers = 0;
                    var playersSortedByKills = ps.concat().sort(function(a, b) { return b.kills - a.kills; });

                    playersSortedByKills.forEach(function(p) {
                        totalPlayers++;
                        totalKills += p.kills;
                    });

                    pageContent = pageContent + "<b>Total Players:</b> " + totalPlayers + "<br />";
                    pageContent = pageContent + "<b>Total Kills:</b> " + totalKills + "<br />&nbsp;<br />";

                    for (var i = 0; i < playersSortedByKills.length; i++) {
                        pageContent = pageContent + '#' + (i + 1) + ': <a style="color: inherit;" href="/player/' + server.name + '/' + playersSortedByKills[i].playerName + '/">' + playersSortedByKills[i].playerName + '</a> (' + playersSortedByKills[i].playerRace + ') - ' + playersSortedByKills[i].kills + ' (' + (playersSortedByKills[i].kills / playersSortedByKills[i].gamesPlayed).toFixed(2) + ' kills per game)<br />';
                    }
                    pageContent = pageContent + '</td></tr></table></center></td></tr>';

                    res.setHeader('Content-Type', 'text/html');
                    res.send(self.cache_get('index.html').toString().replace('##PAGECONTENT##', pageContent));
                }, function(error) {
                    pageContent = pageContent + '<p style="color: #610B0B; margin-top: 1px; margin-bottom: 1px; margin-left: 1px; margin-right: 1px;">Error reading player statistics.</p>';
                    pageContent = pageContent + '</td></tr></table></center></td></tr>';
                    res.setHeader('Content-Type', 'text/html');
                    res.send(self.cache_get('index.html').toString().replace('##PAGECONTENT##', pageContent));
                });
            }
        };

        self.routes['/deaths/:server'] = function(req, res) {
            var serverName = req.params.server;
            var pageContent = "";

            for (var i = 0; i < config.servers.length; i++) {
                if (config.servers[i].name === serverName) {
                    var server = config.servers[i];
                }
            }

            if (typeof server === 'undefined') {
                pageContent = '<tr><td><center><p class="serverTitle">' + serverName.charAt(0).toUpperCase() + serverName.slice(1) + '</p></center></td></tr>' +
                    '<tr><td valign="top" bgcolor="#606060" style="border-style:groove; border-color:#C0C0C0"><center><table width="100%">' +
                    '<tr><td bgcolor="#F3E2A9"><center><p class="sectionTitle">Player Death Count</p></center></td></tr>' +
                    '<tr><td> A server named ' + serverName + ' does not exist.</td></tr></table></center></td></tr>';
                res.setHeader('Content-Type', 'text/html');
                res.send(self.cache_get('index.html').toString().replace('##PAGECONTENT##', pageContent));
            } else {
                pageContent = '<tr><td><center><p class="serverTitle">' + server.name.charAt(0).toUpperCase() + server.name.slice(1) + '</p></center></td></tr>' +
                    '<tr><td valign="top" bgcolor="#606060" style="border-style:groove; border-color:#C0C0C0"><center><table width="100%">' +
                    '<tr><td bgcolor="#F3E2A9"><center><p class="sectionTitle">Player Death Count</p></center></td></tr>' +
                    '<tr><td>';

                getPlayerStats(server).then(function(ps) {
                    var totalDeaths = 0;
                    var totalPlayers = 0;
                    var playersSortedByDeaths = ps.concat().sort(function(a, b) { return b.deaths - a.deaths; });

                    playersSortedByDeaths.forEach(function(p) {
                        totalPlayers++;
                        totalDeaths += p.deaths;
                    });

                    pageContent = pageContent + "<b>Total Players:</b> " + totalPlayers + "<br />";
                    pageContent = pageContent + "<b>Total Deaths:</b> " + totalDeaths + "<br />&nbsp;<br />";

                    for (var i = 0; i < playersSortedByDeaths.length; i++) {
                        pageContent = pageContent + '#' + (i + 1) + ': <a style="color: inherit;" href="/player/' + server.name + '/' + playersSortedByDeaths[i].playerName + '/">' + playersSortedByDeaths[i].playerName + '</a> (' + playersSortedByDeaths[i].playerRace + ') - ' + playersSortedByDeaths[i].deaths + ' (' + (playersSortedByDeaths[i].kills / playersSortedByDeaths[i].gamesPlayed).toFixed(2) + 'deaths per game)<br />';
                    }
                    pageContent = pageContent + '</td></tr></table></center></td></tr>';

                    res.setHeader('Content-Type', 'text/html');
                    res.send(self.cache_get('index.html').toString().replace('##PAGECONTENT##', pageContent));
                }, function(error) {
                    pageContent = pageContent + '<p style="color: #610B0B; margin-top: 1px; margin-bottom: 1px; margin-left: 1px; margin-right: 1px;">Error reading player statistics.</p>';
                    pageContent = pageContent + '</td></tr></table></center></td></tr>';
                    res.setHeader('Content-Type', 'text/html');
                    res.send(self.cache_get('index.html').toString().replace('##PAGECONTENT##', pageContent));
                });
            }
        };

        self.routes['/player/:server/:player'] = function(req, res) {
            var serverName = req.params.server;
            var playerToShow = req.params.player;
            var pageContent = '<tr><td><center><p class="serverTitle">' + serverName.charAt(0).toUpperCase() + serverName.slice(1) + ' - ' + playerToShow + '</p></center></td></tr>' +
                    '<tr><td valign="top" bgcolor="#606060" style="border-style:groove; border-color:#C0C0C0"><center><table width="100%">' +
                    '<tr><td bgcolor="#F3E2A9"><center><p class="sectionTitle">Player Statistics</p></center></td></tr>' +
                    '<tr><td>';


            for (var i = 0; i < config.servers.length; i++) {
                if (config.servers[i].name === serverName) {
                    var server = config.servers[i];
                }
            }

            if (typeof server === 'undefined') {
                pageContent = pageContent + 'A server named ' + serverName + ' does not exist.</td></tr></table></center></td></tr>';
                res.setHeader('Content-Type', 'text/html');
                res.send(self.cache_get('index.html').toString().replace('##PAGECONTENT##', pageContent));
            } else {
                getPlayerStats(server).then(function(ps) {
                    for (var i = 0; i < ps.length; i++) {
                        if (ps[i].playerName.toLowerCase() === playerToShow.toLowerCase()) {
                            var player = ps[i];
                        }
                    }

                    if (typeof player === 'undefined') {
                        pageContent = pageContent + 'A player named ' + playerToShow + ' does not exist on the server ' + serverName +'.</td></tr></table></center></td></tr>';
                        res.setHeader('Content-Type', 'text/html');
                        res.send(self.cache_get('index.html').toString().replace('##PAGECONTENT##', pageContent));
                    } else {
                        pageContent = pageContent + '<center><table width="60%"><tr><td width=25% valign="center"><img width="300" src="/images/' + player.playerRace.toLowerCase() + '-stand.png" /></td><td>';
                        pageContent = pageContent + '<b>Player Name:</b> ' + player.playerName + '<br />';
                        pageContent = pageContent + '<b>Player Faction:</b> ' + player.playerFaction + '<br />';
                        pageContent = pageContent + '<b>Player Race:</b> ' + player.playerRace + '<br />';
                        pageContent = pageContent + '<b>Player Type:</b> ' + player.playerType + '<br />';
                        pageContent = pageContent + '<b>Kills:</b> ' + player.kills + ' (' + (player.kills / player.gamesPlayed).toFixed(2) + ' kills per game)<br />';
                        pageContent = pageContent + '<b>Deaths:</b> ' + player.deaths + ' (' + (player.deaths / player.gamesPlayed).toFixed(2) + ' deaths per game)<br />';
                        pageContent = pageContent + '<b>KDR:</b> ' + (player.kills / player.deaths).toFixed(2) + '<br />';
                        pageContent = pageContent + '<b>Rounds Played:</b> ' + player.gamesPlayed + '<br />';
                        pageContent = pageContent + '</td></tr></table></center>';

                        pageContent = pageContent + '</td></tr></table></center></td></tr>';
                        res.setHeader('Content-Type', 'text/html');
                        res.send(self.cache_get('index.html').toString().replace('##PAGECONTENT##', pageContent));
                    }
                }, function(error) {
                    pageContent = pageContent + '<p style="color: #610B0B; margin-top: 1px; margin-bottom: 1px; margin-left: 1px; margin-right: 1px;">Error reading player statistics.</p></td></tr></table></center></td></tr>';
                    res.setHeader('Content-Type', 'text/html');
                    res.send(self.cache_get('index.html').toString().replace('##PAGECONTENT##', pageContent));
                });
            }
        };

    };


    /**
     *  Initialize the server (express) and create the routes and register
     *  the handlers.
     */
    self.initializeServer = function() {
        self.createRoutes();
        self.app = express();

        self.app.use('/images', express.static(__dirname+'/images'));

        //  Add handlers for the app (from the routes).
        for (var r in self.routes) {
            self.app.get(r, self.routes[r]);
        }
    };


    /**
     *  Initializes the sample application.
     */
    self.initialize = function() {
        self.setupVariables();
        self.populateCache();
        self.setupTerminationHandlers();

        // Create the express server and routes.
        self.initializeServer();
    };


    /**
     *  Start the server (starts up the sample application).
     */
    self.start = function() {
        //  Start the app on the specific interface (and port).
        self.app.listen(self.port, self.ipaddress, function() {
            console.log('%s: Node server started on %s:%d ...',
                        Date(Date.now() ), self.ipaddress, self.port);
        });
    };

};   /*  Sample Application.  */



/**
 *  main():  Main code.
 */
var zapp = new SampleApp();
zapp.initialize();
zapp.start();

var n = require('child_process').fork(__dirname + '/cu-chatbot.js');
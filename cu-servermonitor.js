/* Camelot Unchained server status monitor

To use, run `node cu-servermonitor.js`

Requires:
 - isomorphic-fetch
 - moment --
 - request --
 - bluebird*
 - Camelot Unchained account

* The bluebird module is only required when using older versions of Node.js
which don't have Promise support.

Optional:
 - node-pushover - Needed to send Pushover notifications.
 - node-applescript - Needed to send iMessage notifications. Requires OSX.
 - aws-sdk - Needed to send push notifications (SMS/email/etc.) via AWS SNS.

Server Access Levels:
  Invalid = -1,
  Public = 0,
  Beta3 = 1,
  Beta2 = 2,
  Beta1 = 3,
  Alpha = 4,
  IT = 5, // called InternalTest in API
  Devs = 6, // called Employees in API

Server Status Levels:
  Offline = 0
  Online = 2

*/

var config = require('./cu-servermonitor.cfg');

var util = require('util');
var fs = require('fs');
var fetch = require('isomorphic-fetch');
var moment = require('moment');
var request = require('request');

if (typeof Promise === 'undefined') Promise = require('bluebird');

/*****************************************************************************/
/*****************************************************************************/

// function to check if server exists in data file and return it's data
function getExistingServer(servername) {
    for (i=0; i < servers.length; i++) {
        if (servers[i].name === servername) return servers[i];
    }
    return false;
}

// function to query CU GraphQL data
function gql(query, variables) {
    var url = 'http://api.camelotunchained.com/graphql';
    var headers = {
        'api-version': '1.0',
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    };
    var body = JSON.stringify({ query, variables });
    return new Promise((resolve, reject) => {
        fetch(url, { method: 'post', headers, body })
        .then((response) => {
            response.json().then((data) => {
                if (response.status === 200 && data.data) {
                    resolve(data.data);
                    return;
                }
                console.log('gql: reject status: ' + response.status + ' message: ' + data.Message);
                reject({ status: response.status, message: data.Message });
            });
        })
        .catch((reason) => {
            console.error(reason.message);
            reject({ reason: 'API server unavailable.' });
        });
    });
}

// function to get CUBE count
function getCUBECount(callback) {
    var url = "http://camelotunchained.com/v2/c-u-b-e/";
    request(url, function(error, response, body) {
        if (!error) {
            var re = /<h2 id="cube_count_number">([0-9,]+)<\/h2>/ig;
            var cubeCount = re.exec(body);
            if (cubeCount !== null) {
                callback(cubeCount[1]);
            } else {
                callback("Unknown");
            }
        }
    });
}

// function to read the saved server data
function getSavedServers() {
    fs.readFile(config.serverDataFile, function(err, data) {
        if (err && err.code === 'ENOENT') {
            util.log("[STATUS] Server data file did not exist.");
            return;
        } else {
            return JSON.parse(data);
        }
    });
}

// function to send iMessage notification
function sendiMessage(user, message) {
    var applescript = require('applescript');
    applescript.execFile('imessage.applescript', ['imessage.applescript', user, message], function(err, rtn) {
        if (err) {
            util.log("[ERROR] Error sending iMessage: " + err);
        }
    });
}

// function to send Pushover notification
function sendPushover(user, title, message) {
    var pushover = require('node-pushover');
    var push = new pushover({token: config.poAppToken});
    push.send(user, title, message);
}

// function to send SMS notification
function sendSMS(phone, message) {
    var url = "http://textbelt.com/text?number=" + phone + "&message=" + message;
    var req = {
        headers: {'content-type' : 'application/x-www-form-urlencoded'},
        url: 'http://textbelt.com/text',
        body: 'number=' + phone + '&message=' + message
    };
    request.post(req, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            if (! JSON.parse(body).success) {
                util.log("[ERROR] Error sending SMS: " + JSON.parse(body).message);
            }
        }
    });
}

// function to send AWS SNS notification
function sendSNS(arn, message, subject) {
    var AWS = require('aws-sdk');
    AWS.config.region = 'us-east-1';
    var sns = new AWS.SNS();

    var params = {
      Message: message,
      Subject: subject,
      TopicArn: arn
    };

    sns.publish(params, function(err, data) {
        if (err) util.log("[ERROR] Error sending SNS: " + err);
    });
}

// function to send a server notification to Alpha players
function sendToAlpha(message) {
    config.poAlphaNotices.forEach(function(poID) {
        sendPushover(poID, "[CU]", message);
    });
    config.snsAlphaNotices.forEach(function(arn) {
        sendSNS(arn, message, message);
    });
}

// function to send a server notification to Beta1 players
function sendToBeta1(message) {
    config.poBeta1Notices.forEach(function(poID) {
        sendPushover(poID, "[CU]", message);
    });
    config.snsBeta1Notices.forEach(function(arn) {
        sendSNS(arn, message, message);
    });
}

// function to send a server notification to Beta2 players
function sendToBeta2(message) {
    config.poBeta2Notices.forEach(function(poID) {
        sendPushover(poID, "[CU]", message);
    });
    config.snsBeta2Notices.forEach(function(arn) {
        sendSNS(arn, message, message);
    });
}

// function to send a server notification to Beta3 players
function sendToBeta3(message) {
    config.poBeta3Notices.forEach(function(poID) {
        sendPushover(poID, "[CU]", message);
    });
    config.snsBeta3Notices.forEach(function(arn) {
        sendSNS(arn, message, message);
    });
}

// function to send a server notification to IT players
function sendToIT(message) {
    config.poITNotices.forEach(function(poID) {
        sendPushover(poID, "[CU]", message);
    });
    config.snsITNotices.forEach(function(arn) {
        sendSNS(arn, message, message);
    });
}

// Timer to monitor server status via API
var timerServerStatus = function() { checkServerStatus(); return setInterval(function() { checkServerStatus(); }, 10000); };
function checkServerStatus() {
    gql('{ connectedServices { servers { name status accessLevel playerMaximum apiHost } } }').then(function(data) {
        data = data.connectedServices.servers;
        for (var i = 0; i < data.length; i++) {
            var serverEntry = data[i];
            var existingServer = getExistingServer(serverEntry.name);
            if (existingServer) {
                // Server exists in data file
                if ((serverEntry.accessLevel !== existingServer.accessLevel) ||
                    (serverEntry.status !== existingServer.status) ||
                    (serverEntry.playerMaximum !== existingServer.playerMaximum)
                ){
                    // Update existing server with new status
                    existingServer.status = serverEntry.status;
                    existingServer.accessLevel = serverEntry.accessLevel;
                    existingServer.playerMaximum = serverEntry.playerMaximum;
                    existingServer.apiHost = serverEntry.apiHost;
                    existingServer.lastUpdate = new Date();
                }
            } else {
                // Server does not exist in data file
                var currentDate = new Date();
                // *** mess with hatchery to force an update!
                if (serverEntry.name === 'Hatchery') serverEntry.status = 69;
                servers.push({
                    name: serverEntry.name,
                    status: serverEntry.status,
                    accessLevel: serverEntry.accessLevel,
                    playerMaximum: serverEntry.playerMaximum,
                    apiHost: serverEntry.apiHost,
                    lastUpdate: currentDate,
                    lastNotice: currentDate
                });
                util.log("[STATUS] New server added to tracking list (" + serverEntry.name + ").");
                // *** send notice to admins!!
            }
        }
    }, function(error) {
        util.log("[ERROR] Poll of server data failed.");
    });
};

var timerNotifications = function() { checkNotifications(); return setInterval(function() { checkNotifications(); }, 1000); };
function checkNotifications() {
    for (i = 0; i < servers.length; i++) {
        // Change this to be if last notice was *before* last update
        if (servers[i].lastUpdate !== servers[i].lastNotice) {
            console.log('server has been updated: ' + servers[i].name);
        }
    }
    util.log('notification check');
};

var timerServerOnline = function(server) { return setInterval(function() { checkServerOnline(server); }, 60000); };
function checkServerOnline(server) {
    var epochTime = Math.floor((new Date).getTime() / 1000);

    server.cuRest.getServers().then(function(data) {
        var currentOnline = false;
        var currentAccess = 6;
        var statusChange = false;
        for (var j = 0; j < data.length; j++) {
            var serverEntry = data[j];
            console.log('***');
            console.dir(serverEntry);
            if (serverEntry.name.toLowerCase() === server.name.toLowerCase()) {
                if (serverEntry.status === 2) currentOnline = true;
                currentAccess = serverEntry.accessLevel;


                if (! onlineStats[server.name].online && currentOnline) {
                    // Server was offline, is now online.
                    statusChange = true;
                    for (var i = 5; i > currentAccess - 1; i--) {
                        switch(i) {
                            case 5:
                                // Server now open to IT -- Send notice to IT
                                sendToIT("The server '" + server.name + "' is now online and allowing access to IT players.");
                                util.log("[GAME] Server access status message sent to users. (IT)");
                                break;
                            case 4:
                                // Server now open to Alpha -- Send notice to Alpha
                                sendToAlpha("The server '" + server.name + "' is now online and allowing access to Alpha players.");
                                util.log("[GAME] Server access status message sent to users. (Alpha)");
                                break;
                            case 3:
                                // Server now open to Beta1 -- Send notice to Beta1
                                sendToBeta1("The server '" + server.name + "' is now online and allowing access to Beta1 players.");
                                util.log("[GAME] Server access status message sent to users. (Beta1)");
                                break;
                            case 2:
                                // Server now open to Beta2 -- Send notice to Beta2
                                sendToBeta2("The server '" + server.name + "' is now online and allowing access to Beta2 players.");
                                util.log("[GAME] Server access status message sent to users. (Beta2)");
                                break;
                            case 1:
                                // Server now open to Beta3 -- Send notice to Beta3
                                sendToBeta3("The server '" + server.name + "' is now online and allowing access to Beta3 players.");
                                util.log("[GAME] Server access status message sent to users. (Beta3)");
                                break;
                        }
                    }
                } else {
                    if (onlineStats[server.name].accessLevel < currentAccess) {
                        // Server was online but access level has gone up
                        statusChange = true;
                        for (var i = onlineStats[server.name].accessLevel; i < currentAccess; i++) {
                            switch(i) {
                                case 5:
                                    // Server no longer open to IT -- Send notice to IT
                                    sendToIT("The server '" + server.name + "' is no longer allowing access to IT players.");
                                    util.log("[GAME] Server access status message sent to users. (IT)");
                                    break;
                                case 4:
                                    // Server no longer open to Alpha -- Send notice to Alpha
                                    sendToAlpha("The server '" + server.name + "' is no longer allowing access to Alpha players.");
                                    util.log("[GAME] Server access status message sent to users. (Alpha)");
                                    break;
                                case 3:
                                    // Server no longer open to Beta1 -- Send notice to Beta1
                                    sendToBeta1("The server '" + server.name + "' is no longer allowing access to Beta1 players.");
                                    util.log("[GAME] Server access status message sent to users. (Beta1)");
                                    break;
                                case 2:
                                    // Server no longer open to Beta2 -- Send notice to Beta2
                                    sendToBeta2("The server '" + server.name + "' is no longer allowing access to Beta2 players.");
                                    util.log("[GAME] Server access status message sent to users. (Beta2)");
                                    break;
                                case 1:
                                    // Server no longer open to Beta3 -- Send notice to Beta3
                                    sendToBeta3("The server '" + server.name + "' is no longer allowing access to Beta3 players.");
                                    util.log("[GAME] Server access status message sent to users. (Beta3)");
                                    break;
                            }
                        }
                    } else if (onlineStats[server.name].accessLevel > currentAccess) {
                        // Server was online but access level has gone down
                        statusChange = true;
                        for (var i = onlineStats[server.name].accessLevel - 1; i > currentAccess - 1; i--) {
                            switch(i) {
                                case 5:
                                    // Server now open to IT -- Send notice to IT
                                    sendToIT("The server '" + server.name + "' is now allowing access to IT players.");
                                    util.log("[GAME] Server access status message sent to users. (IT)");
                                    break;
                                case 4:
                                    // Server now open to Alpha -- Send notice to Alpha
                                    sendToAlpha("The server '" + server.name + "' is now allowing access to Alpha players.");
                                    util.log("[GAME] Server access status message sent to users. (Alpha)");
                                    break;
                                case 3:
                                    // Server now open to Beta1 -- Send notice to Beta1
                                    sendToBeta1("The server '" + server.name + "' is now allowing access to Beta1 players.");
                                    util.log("[GAME] Server access status message sent to users. (Beta1)");
                                    break;
                                case 2:
                                    // Server now open to Beta2 -- Send notice to Beta2
                                    sendToBeta2("The server '" + server.name + "' is now allowing access to Beta2 players.");
                                    util.log("[GAME] Server access status message sent to users. (Beta2)");
                                    break;
                                case 1:
                                    // Server now open to Beta3 -- Send notice to Beta3
                                    sendToBeta3("The server '" + server.name + "' is now allowing access to Beta3 players.");
                                    util.log("[GAME] Server access status message sent to users. (Beta3)");
                                    break;
                            }
                        }
                    }
                }
                break;
            }
        }

        if (onlineStats[server.name].online && ! currentOnline) {
            // Server was online, is now offline.
            statusChange = true;
            for (var i = 5; i > onlineStats[server.name].accessLevel - 1; i--) {
                switch(i) {
                    case 5:
                        // Server now open to IT -- Send notice to IT
                        sendToIT("The server '" + server.name + "' is now offline.");
                        util.log("[GAME] Server access status message sent to users. (IT)");
                        break;
                    case 4:
                        // Server now open to Alpha -- Send notice to Alpha
                        sendToAlpha("The server '" + server.name + "' is now offline.");
                        util.log("[GAME] Server access status message sent to users. (Alpha)");
                        break;
                    case 3:
                        // Server now open to Beta1 -- Send notice to Beta1
                        sendToBeta1("The server '" + server.name + "' is now offline.");
                        util.log("[GAME] Server access status message sent to users. (Beta1)");
                        break;
                    case 2:
                        // Server now open to Beta2 -- Send notice to Beta2
                        sendToBeta2("The server '" + server.name + "' is now offline.");
                        util.log("[GAME] Server access status message sent to users. (Beta2)");
                        break;
                    case 1:
                        // Server now open to Beta3 -- Send notice to Beta3
                        sendToBeta3("The server '" + server.name + "' is now offline.");
                        util.log("[GAME] Server access status message sent to users. (Beta3)");
                        break;
                }
            }
        }

        if (statusChange) {
            onlineStats[server.name].online = currentOnline;
            onlineStats[server.name].accessLevel = currentAccess;
            onlineStats[server.name].lastNotice = epochTime;

            fs.writeFile(server.onlineFile, JSON.stringify(onlineStats[server.name]), function(err) {
                if (err) {
                    return util.log("[ERROR] Unable to write server access status stats file (" + server.name + ").");
                }
                util.log("[STATUS] Server access status stats file saved (" + server.name + ").");
            });
        }
    }, function(error) {
        util.log("[ERROR] Poll of server data failed.");
    });
}

/*****************************************************************************/
/*****************************************************************************/

// Initial startup
var servers = getSavedServers();
if (typeof servers !== 'Array') servers = [];

var serverStatusTimer = timerServerStatus();
var notificationTimer = timerNotifications();

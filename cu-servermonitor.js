/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

 /* Camelot Unchained server status monitor

To use, run `node cu-servermonitor.js`

Requires:
 - isomorphic-fetch
 - es6-promise*

* The es6-promise module is only required when using older versions of Node.js
which don't have Promise support.

Optional (at least one is required):
 - node-pushover - Needed to send Pushover notifications.
 - node-applescript - Needed to send iMessage notifications. Requires OSX.
 - aws-sdk - Needed to send push notifications (SMS/email/etc.) via AWS SNS.

*/

var webserver = require('child_process').fork(__dirname + '/server.js');

var config = require('./cu-servermonitor.cfg');

var util = require('util');
var fs = require('fs');
var fetch = require('isomorphic-fetch');

// When using older versions of Node.js without Promise support,
// use the es6-promise polyfill
if (typeof Promise === 'undefined') require('es6-promise').polyfill();

/*****************************************************************************/
/*****************************************************************************/

// function to check if server exists in data file and return it's data
function getExistingServer(servername) {
    for (i=0; i < servers.length; i++) {
        if (servers[i].name === servername) return servers[i];
    }
    return false;
}

// function to read saved server data
function getSavedServers() {
    function reviver(key, value) {
        if ((key === "lastUpdate" || key === "lastNotice") && typeof value === "string" ) {
            return new Date(value);
        }
        return value;
    }

    try {
        return JSON.parse(fs.readFileSync(config.serverDataFile), reviver);
    } catch(error) {
        util.log("[STATUS] Could not read server data file.");
        return [];
    }
}

// function to query CU GraphQL data - mostly taken from CU client source
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
            reject({ reason: 'API server unavailable' });
        });
    });
}

// function to compare access levels
function hasAccess(userLevel, serverLevel) {
    if (userLevel === serverLevel) return true;

    var accessLevels = {
        'Invalid': -1,
        'Public': 0,
        'Beta3': 1,
        'Beta2': 2,
        'Beta1': 3,
        'Alpha': 4,
        'InternalTest': 5,
        'Employees': 6
    };

    if (typeof accessLevels[userLevel] === 'undefined') userLevel = 'Invalid';
    if (typeof accessLevels[serverLevel] === 'undefined') {
        util.log("[ERROR] Server has unexpected access level (" + serverLevel + ").");
        serverLevel = 'Employees';
    }
    if (accessLevels[userLevel] > accessLevels[serverLevel]) return true;
    return false;
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

// function to send AWS SNS notification
function sendSNS(arn, message, subject) {
    var AWS = require('aws-sdk');
    AWS.config.update({
        accessKeyId: config.snsAccessID,
        secretAccessKey: config.snsSecretKey,
        region: config.snsRegion
    });
    // AWS.config.region = 'us-east-1';
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

// function to send a server notification to script administrators
function sendToAdmin(message) {
    config.poAdminNotices.forEach(function(poID) {
        sendPushover(poID, "[CU]", message);
    });
    config.snsAdminNotices.forEach(function(arn) {
        sendSNS(arn, message, message);
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
                servers.push({
                    name: serverEntry.name,
                    status: serverEntry.status,
                    accessLevel: serverEntry.accessLevel,
                    playerMaximum: serverEntry.playerMaximum,
                    apiHost: serverEntry.apiHost,
                    itAccess: (hasAccess('InternalTest', serverEntry.accessLevel) && serverEntry.status === 'Online' && serverEntry.playerMaximum > 0),
                    alphaAccess: (hasAccess('Alpha', serverEntry.accessLevel) && serverEntry.status === 'Online' && serverEntry.playerMaximum > 0),
                    beta1Access: (hasAccess('Beta1', serverEntry.accessLevel) && serverEntry.status === 'Online' && serverEntry.playerMaximum > 0),
                    beta2Access: (hasAccess('Beta2', serverEntry.accessLevel) && serverEntry.status === 'Online' && serverEntry.playerMaximum > 0),
                    beta3Access: (hasAccess('Beta3', serverEntry.accessLevel) && serverEntry.status === 'Online' && serverEntry.playerMaximum > 0),
                    lastUpdate: currentDate,
                    lastNotice: currentDate
                });
                sendToAdmin("New server added to tracking list (" + serverEntry.name + ").");
                util.log("[STATUS] New server added to tracking list (" + serverEntry.name + ").");
            }
        }
    }, function(error) {
        util.log("[ERROR] Polling of server data failed.");
    });
};

var timerNotifications = function() { return setInterval(function() { checkNotifications(); }, 1000); };
function checkNotifications() {
    for (i = 0; i < servers.length; i++) {
        if (servers[i].lastUpdate > servers[i].lastNotice) {
            util.log("[STATUS] Server status updated (" + servers[i].name + ").");
            if (servers[i].status === 'Online' && servers[i].playerMaximum > 0) {
                if (hasAccess('InternalTest', servers[i].accessLevel)) {
                    if (!servers[i].itAccess) {
                        servers[i].itAccess = true;
                        sendToIT("The server '" + servers[i].name + "' is now online and allowing access to IT players.");
                        util.log("[NOTICE] Server online status message sent to users. (IT)");
                    }
                } else {
                    if (servers[i].itAccess) {
                        servers[i].itAccess = false;
                        sendToIT("The server '" + servers[i].name + "' is no longer online or allowing access to IT players.");
                        util.log("[NOTICE] Server offline status message sent to users. (IT)");
                    }
                }
                if (hasAccess('Alpha', servers[i].accessLevel)) {
                    if (!servers[i].alphaAccess) {
                        servers[i].alphaAccess = true;
                        sendToAlpha("The server '" + servers[i].name + "' is now online and allowing access to Alpha players.");
                        util.log("[NOTICE] Server online status message sent to users. (Alpha)");
                    }
                } else {
                    if (servers[i].alphaAccess) {
                        servers[i].alphaAccess = false;
                        sendToAlpha("The server '" + servers[i].name + "' is no longer online or allowing access to Alpha players.");
                        util.log("[NOTICE] Server offline status message sent to users. (Alpha)");
                    }
                }
                if (hasAccess('Beta1', servers[i].accessLevel)) {
                    if (!servers[i].beta1Access) {
                        servers[i].beta1Access = true;
                        sendToBeta1("The server '" + servers[i].name + "' is now online and allowing access to Beta 1 players.");
                        util.log("[NOTICE] Server online status message sent to users. (Beta1)");
                    }
                } else {
                    if (servers[i].beta1Access) {
                        servers[i].beta1Access = false;
                        sendToBeta1("The server '" + servers[i].name + "' is no longer online or allowing access to Beta 1 players.");
                        util.log("[NOTICE] Server offline status message sent to users. (Beta1)");
                    }
                }
                if (hasAccess('Beta2', servers[i].accessLevel)) {
                    if (!servers[i].beta2Access) {
                        servers[i].beta2Access = true;
                        sendToBeta2("The server '" + servers[i].name + "' is now online and allowing access to Beta 2 players.");
                        util.log("[NOTICE] Server online status message sent to users. (Beta2)");
                    }
                } else {
                    if (servers[i].beta2Access) {
                        servers[i].beta2Access = false;
                        sendToBeta2("The server '" + servers[i].name + "' is no longer online or allowing access to Beta 2 players.");
                        util.log("[NOTICE] Server offline status message sent to users. (Beta2)");
                    }
                }
                if (hasAccess('Beta3', servers[i].accessLevel)) {
                    if (!servers[i].beta3Access) {
                        servers[i].beta3Access = true;
                        sendToBeta3("The server '" + servers[i].name + "' is now online and allowing access to Beta 3 players.");
                        util.log("[NOTICE] Server online status message sent to users. (Beta3)");
                    }
                } else {
                    if (servers[i].beta3Access) {
                        servers[i].beta3Access = false;
                        sendToBeta3("The server '" + servers[i].name + "' is no longer online or allowing access to Beta 3 players.");
                        util.log("[NOTICE] Server offline status message sent to users. (Beta3)");
                    }
                }
            } else if (servers[i].status === 'Offline' || servers[i].playerMaximum < 1){
                if (servers[i].itAccess) {
                    servers[i].itAccess = false;
                    sendToIT("The server '" + servers[i].name + "' is no longer online or allowing access to IT players.");
                    util.log("[NOTICE] Server offline status message sent to users. (IT)");
            }
                if (servers[i].alphaAccess) {
                    servers[i].alphaAccess = false;
                    sendToAlpha("The server '" + servers[i].name + "' is no longer online or allowing access to Alpha players.");
                    util.log("[NOTICE] Server offline status message sent to users. (Alpha)");
            }
                if (servers[i].beta1Access) {
                    servers[i].beta1Access = false;
                    sendToBeta1("The server '" + servers[i].name + "' is no longer online or allowing access to Beta 1 players.");
                    util.log("[NOTICE] Server offline status message sent to users. (Beta1)");
            }
                if (servers[i].beta2Access) {
                    servers[i].beta2Access = false;
                    sendToBeta2("The server '" + servers[i].name + "' is no longer online or allowing access to Beta 2 players.");
                    util.log("[NOTICE] Server offline status message sent to users. (Beta2)");
            }
                if (servers[i].beta3Access) {
                    servers[i].beta3Access = false;
                    sendToBeta3("The server '" + servers[i].name + "' is no longer online or allowing access to Beta 3 players.");
                    util.log("[NOTICE] Server offline status message sent to users. (Beta3)");
                }
            }

            // Set last notification timestamp and write servers to file
            servers[i].lastNotice = new Date();
            fs.writeFile(config.serverDataFile, JSON.stringify(servers), function(err) {
                if (err) {
                    return util.log("[ERROR] Unable to write server data file (" + config.serverDataFile + ").");
                }
                util.log("[STATUS] Server data file saved (" + config.serverDataFile + ").");
            });
        }
    }
};

/*****************************************************************************/
/*****************************************************************************/

// Initial startup
var servers = getSavedServers();
var serverStatusTimer = timerServerStatus();
var notificationTimer = timerNotifications();

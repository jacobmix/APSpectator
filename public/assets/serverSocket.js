// noinspection JSBitwiseOperatorUsage

// Archipelago server
const DEFAULT_SERVER_PORT = 38281;
let serverSocket = null;
let lastServerAddress = null;
let serverPassword = null;
let serverAuthError = false;

// Track reconnection attempts.
const maxReconnectAttempts = 10;
let preventReconnect = false;
let reconnectAttempts = 0;
let reconnectTimeout = null;

// Players in the current game, received from Connected server packet
let playerSlot = null;
let playerTeam = null;
let players = [];

window.addEventListener('load', () => {
  // Handle server address change
  document.getElementById('server-address').addEventListener('keydown', beginConnectionAttempt);
  document.getElementById('player').addEventListener('keydown', beginConnectionAttempt);

  const url = new URL(window.location);
  const server = url.searchParams.get('server');
  const player = url.searchParams.get('player');

  if (server && player) {
    connectToServer(server, player, url.searchParams.get('password'));
  }

  if (!!parseInt(url.searchParams.get('hideui'))) {
    document.getElementById('header').classList.add('hidden');
    document.getElementById('console-input-wrapper').classList.add('hidden');
  }
});

const beginConnectionAttempt = (event) => {
  if (event.key !== 'Enter') { return; }

  // User-input values
  const address = document.getElementById('server-address').value;
  const player = document.getElementById('player').value;

  // If the input value is empty, do not attempt to reconnect
  if (!address || !player) {
    appendConsoleMessage('A server and player name are required to connect.');
    preventReconnect = true;
    lastServerAddress = null;

    // If the socket is open, close it
    if (serverSocket && serverSocket.readyState === WebSocket.OPEN) {
      serverSocket.close();
      serverSocket = null;
    }

    // If the user did not specify a server address or player, do not attempt to connect
    return;
  }

  // User specified a server. Attempt to connect
  preventReconnect = false;
  connectToServer(address, player);
};

const connectToServer = (address, player, password = null) => {
  if (serverSocket && serverSocket.readyState === WebSocket.OPEN) {
    serverSocket.close();
    serverSocket = null;
  }

  // If an empty string is passed as the address, do not attempt to connect
  if (!address) { return; }

  // This is a new connection attempt, no auth error has occurred yet
  serverAuthError = false;

  // Determine the server address
  let serverAddress = address;
  if (serverAddress.search(/^\/connect /) > -1) { serverAddress = serverAddress.substring(9); }
  if (serverAddress.search(/:\d+$/) === -1) { serverAddress = `${serverAddress}:${DEFAULT_SERVER_PORT}`;}

  // Store the password, if given
  serverPassword = password;

  // Try connecting with wss first, then fallback to ws if necessary
  tryWebSocketConnection(`wss://${serverAddress}`, player, 0, maxReconnectAttempts, true, (success) => {
    if (!success) {
      tryWebSocketConnection(`ws://${serverAddress}`, player, 0, maxReconnectAttempts, false);
    }
  });
};

const tryWebSocketConnection = (url, player, attempts, maxAttempts, isSecure, callback) => {
  if (attempts >= maxAttempts) {
    if (callback) callback(false);
    return;
  }

  serverSocket = new WebSocket(url);

  serverSocket.onopen = () => {
    appendConsoleMessage(`Connected to Archipelago server at ${url}`);
    if (callback) callback(true);
  };

  serverSocket.onmessage = (event) => {
    console.log(event);

    const commands = JSON.parse(event.data);
    for (let command of commands) {
      const serverStatus = document.getElementById('server-status');
      switch (command.cmd) {
        case 'RoomInfo':
          // Authenticate with the server
          const connectionData = {
            cmd: 'Connect',
            game: null,
            name: player,
            uuid: getClientId(),
            tags: ['TextOnly', 'Spectator'],
            password: serverPassword,
            version: ARCHIPELAGO_PROTOCOL_VERSION,
            items_handling: 0b000,
          };
          serverSocket.send(JSON.stringify([connectionData]));
          break;

        case 'Connected':
          // Save the last server that was successfully connected to
          lastServerAddress = url;

          // Reset reconnection info if necessary
          reconnectAttempts = 0;

          // Save the list of players provided by the server
          players = command.players;

          // Save information about the current player
          playerTeam = command.team;
          playerSlot = command.slot;

          // Update header text
          serverStatus.classList.remove('disconnected');
          serverStatus.innerText = 'Connected';
          serverStatus.classList.add('connected');

          requestDataPackage();
          break;

        case 'ConnectionRefused':
          serverStatus.classList.remove('connected');
          serverStatus.innerText = 'Not Connected';
          serverStatus.classList.add('disconnected');
          if (serverSocket && serverSocket.readyState === WebSocket.OPEN) {
            if (command.errors.includes('InvalidPassword')) {
              appendConsoleMessage(serverPassword === null ?
                'A password is required to connect to the server. Please use /connect [server] [password]' :
                'The password you provided was rejected by the server.'
              );
            } else {
              appendConsoleMessage(`Error while connecting to AP server: ${command.errors.join(', ')}.`);
            }
            serverAuthError = true;
            serverSocket.close();
            serverSocket = null;
          }
          break;

        case 'ReceivedItems':
          break;

        case 'LocationInfo':
          break;

        case 'RoomUpdate':
          break;

        case 'Print':
          appendConsoleMessage(command.text);
          break;

        case 'PrintJSON':
          appendFormattedConsoleMessage(command.data);
          break;

        case 'DataPackage':
          buildItemAndLocationData(command.data);
          break;

        case 'Bounced':
          break;

        default:
          // Unhandled events are ignored
          break;
      }
    }
  };

  serverSocket.onclose = () => {
    const serverStatus = document.getElementById('server-status');
    serverStatus.classList.remove('connected');
    serverStatus.innerText = 'Not Connected';
    serverStatus.classList.add('disconnected');

    if (!preventReconnect) {
      reconnectTimeout = setTimeout(() => {
        tryWebSocketConnection(url, player, attempts + 1, maxAttempts, isSecure, callback);
      }, 5000);
    } else if (callback) {
      callback(false);
    }
  };

  serverSocket.onerror = () => {
    if (serverSocket && serverSocket.readyState === WebSocket.OPEN) {
      appendConsoleMessage('Archipelago server connection lost. The connection closed unexpectedly. ' +
        'Please try to reconnect, or restart the client.');
      serverSocket.close();
    }
    if (callback) callback(false);
  };
};

const getClientId = () => {
  let clientId = localStorage.getItem('clientId');
  if (!clientId) {
    clientId = (Math.random() * 10000000000000000).toString();
    localStorage.setItem('clientId', clientId);
  }
  return clientId;
};

const sendMessageToServer = (message) => {
  if (serverSocket && serverSocket.readyState === WebSocket.OPEN) {
    serverSocket.send(JSON.stringify([{
      cmd: 'Say',
      text: message,
    }]));
  }
};

const requestDataPackage = () => {
  if (!serverSocket || serverSocket.readyState !== WebSocket.OPEN) { return; }
  serverSocket.send(JSON.stringify([{
    cmd: 'GetDataPackage',
  }]));
};

const buildItemAndLocationData = (dataPackage) => {
  Object.keys(dataPackage.games).forEach((gameName) => {
    // Build itemId map
    Object.keys(dataPackage.games[gameName].item_name_to_id).forEach((itemName) => {
      apItemsById[dataPackage.games[gameName].item_name_to_id[itemName]] = itemName;
    });

    // Build locationId map
    Object.keys(dataPackage.games[gameName].location_name_to_id).forEach((locationName) => {
      apLocationsById[dataPackage.games[gameName].location_name_to_id[locationName]] = locationName;
    });
  });
};

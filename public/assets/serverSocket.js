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

    return;
  }

  // User specified a server. Attempt to connect
  preventReconnect = false;
  reconnectAttempts = 0; // Reset reconnect attempts on a new connection attempt
  tryAlternateConnections(address, player, reconnectAttempts, maxReconnectAttempts);
};

const tryAlternateConnections = (address, player, attempts, maxAttempts) => {
  if (attempts >= maxAttempts || preventReconnect) {
    appendConsoleMessage('Failed to connect to Archipelago server after maximum attempts.');
    return;
  }

  const isSecureAttempt = attempts % 2 === 0;  // Alternate between wss (even attempts) and ws (odd attempts)
  const protocol = isSecureAttempt ? 'wss' : 'ws';
  const url = `${protocol}://${address}`;

  serverSocket = new WebSocket(url);

  serverSocket.onopen = () => {
    appendConsoleMessage(`Connected to Archipelago server at ${url}`);
    preventReconnect = true; // Stop further reconnection attempts
  };

  serverSocket.onmessage = (event) => {
    console.log(event);

    const commands = JSON.parse(event.data);
    for (let command of commands) {
      const serverStatus = document.getElementById('server-status');
      switch (command.cmd) {
        case 'RoomInfo':
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
          lastServerAddress = address;
          reconnectAttempts = 0;
          players = command.players;
          playerTeam = command.team;
          playerSlot = command.slot;

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
        tryAlternateConnections(address, player, attempts + 1, maxAttempts);
      }, 5000);
    }
  };

  serverSocket.onerror = () => {
    if (serverSocket && serverSocket.readyState === WebSocket.OPEN) {
      appendConsoleMessage('Archipelago server connection lost. The connection closed unexpectedly. ' +
        'Please try to reconnect, or restart the client.');
      serverSocket.close();
    }

    if (!preventReconnect) {
      reconnectTimeout = setTimeout(() => {
        tryAlternateConnections(address, player, attempts + 1, maxAttempts);
      }, 5000);
    }
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
    Object.keys(dataPackage.games[gameName].item_name_to_id).forEach((itemName) => {
      apItemsById[dataPackage.games[gameName].item_name_to_id[itemName]] = itemName;
    });

    Object.keys(dataPackage.games[gameName].location_name_to_id).forEach((locationName) => {
      apLocationsById[dataPackage.games[gameName].location_name_to_id[locationName]] = locationName;
    });
  });
};

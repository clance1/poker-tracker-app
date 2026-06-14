// GraphQL operations for the Poker Tracker app

export const LIST_PLAYERS = /* GraphQL */ `
  query ListPlayers {
    listPlayers {
      items {
        id
        name
        games {
          items {
            id
            buyIn
            rebuys
            cashOut
            game {
              id
              date
              isComplete
            }
          }
        }
      }
    }
  }
`;

export const LIST_GAMES = /* GraphQL */ `
  query ListGames {
    listGames {
      items {
        id
        date
        isComplete
        notes
        players {
          items {
            id
            buyIn
            rebuys
            cashOut
            player {
              id
              name
            }
          }
        }
      }
    }
  }
`;

export const GET_GAME = /* GraphQL */ `
  query GetGame($id: ID!) {
    getGame(id: $id) {
      id
      date
      isComplete
      notes
      players {
        items {
          id
          buyIn
          rebuys
          cashOut
          player {
            id
            name
          }
        }
      }
    }
  }
`;

export const CREATE_PLAYER = /* GraphQL */ `
  mutation CreatePlayer($input: CreatePlayerInput!) {
    createPlayer(input: $input) {
      id
      name
    }
  }
`;

export const DELETE_PLAYER = /* GraphQL */ `
  mutation DeletePlayer($input: DeletePlayerInput!) {
    deletePlayer(input: $input) {
      id
    }
  }
`;

export const CREATE_GAME = /* GraphQL */ `
  mutation CreateGame($input: CreateGameInput!) {
    createGame(input: $input) {
      id
      date
      isComplete
    }
  }
`;

export const UPDATE_GAME = /* GraphQL */ `
  mutation UpdateGame($input: UpdateGameInput!) {
    updateGame(input: $input) {
      id
      isComplete
      notes
    }
  }
`;

export const DELETE_GAME = /* GraphQL */ `
  mutation DeleteGame($input: DeleteGameInput!) {
    deleteGame(input: $input) {
      id
    }
  }
`;

export const CREATE_GAME_PLAYER = /* GraphQL */ `
  mutation CreateGamePlayer($input: CreateGamePlayerInput!) {
    createGamePlayer(input: $input) {
      id
      buyIn
      rebuys
      cashOut
      playerID
      gameID
    }
  }
`;

export const UPDATE_GAME_PLAYER = /* GraphQL */ `
  mutation UpdateGamePlayer($input: UpdateGamePlayerInput!) {
    updateGamePlayer(input: $input) {
      id
      buyIn
      rebuys
      cashOut
    }
  }
`;

export const DELETE_GAME_PLAYER = /* GraphQL */ `
  mutation DeleteGamePlayer($input: DeleteGamePlayerInput!) {
    deleteGamePlayer(input: $input) {
      id
    }
  }
`;

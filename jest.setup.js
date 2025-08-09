import '@testing-library/jest-dom'

// Mock Monaco Editor
global.monaco = {
  editor: {
    create: jest.fn(),
    createModel: jest.fn(),
    setTheme: jest.fn(),
  },
  languages: {
    register: jest.fn(),
    setMonarchTokensProvider: jest.fn(),
    setLanguageConfiguration: jest.fn(),
  },
}

// Mock WebSocket
global.WebSocket = jest.fn(() => ({
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  send: jest.fn(),
  close: jest.fn(),
  readyState: 1,
}))

// Mock Socket.io client
jest.mock('socket.io-client', () => ({
  io: jest.fn(() => ({
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
  })),
}))

// Mock Yjs
jest.mock('yjs', () => ({
  Doc: jest.fn(() => ({
    getText: jest.fn(() => ({
      insert: jest.fn(),
      delete: jest.fn(),
      observe: jest.fn(),
      unobserve: jest.fn(),
      toString: jest.fn(() => ''),
    })),
    on: jest.fn(),
    off: jest.fn(),
    destroy: jest.fn(),
  })),
}))

// Mock y-websocket
jest.mock('y-websocket', () => ({
  WebsocketProvider: jest.fn(() => ({
    on: jest.fn(),
    off: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
    destroy: jest.fn(),
  })),
}))
import { Server as SocketIOServer } from 'socket.io';
import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

// Global socket server instance
let io: SocketIOServer | null = null;

export function getSocketServer(): SocketIOServer | null {
  return io;
}

export function initializeSocketServer() {
  if (io) {
    return io;
  }

  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  app.prepare().then(() => {
    const server = createServer(async (req, res) => {
      try {
        const parsedUrl = parse(req.url!, true);
        await handle(req, res, parsedUrl);
      } catch (err) {
        console.error('Error occurred handling', req.url, err);
        res.statusCode = 500;
        res.end('internal server error');
      }
    });

    io = new SocketIOServer(server, {
      cors: {
        origin: process.env.NODE_ENV === 'production' 
          ? process.env.NEXT_PUBLIC_APP_URL 
          : "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true
      },
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000
    });

    server.listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });
  });

  return io;
}

export interface SocketData {
  roomId?: string;
  userId?: string;
  userName?: string;
  userColor?: string;
}
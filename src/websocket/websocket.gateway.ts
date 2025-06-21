import { Inject, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: false,
})
export class WebsocketGateway implements OnGatewayConnection {
  constructor() {
    Logger.log('WebsocketGateway constructor');
  }

  @WebSocketServer()
  server: Server;

  @Inject(JwtService)
  private jwtService: JwtService;

  private connections = new Map<string, Set<string>>(); // userId -> Set of socketIds

  async handleConnection(client: Socket) {
    try {
      Logger.debug(`Connection attempt - Client ID: ${client.id}`);
      Logger.debug(`Handshake details: ${JSON.stringify(client.handshake)}`);
      Logger.debug(
        `Client handshake auth: ${client.handshake.headers.authorization}`,
      );

      const token =
        client.handshake.headers.authorization?.split(' ')[1] ||
        client.handshake.auth.token;

      if (!token) {
        throw new UnauthorizedException('No token provided');
      }

      const payload = await this.jwtService.verifyAsync(token);
      const userId = payload.user.id;

      client.join(`user-${userId}`);
      Logger.log(`Client connected: ${client.id}, userId: ${userId}`);
      //查看当前房间几个connection
      const room = this.server.sockets.adapter.rooms.get(`user-${userId}`);
      Logger.log(`Current connections in room user-${userId}: ${room?.size}`);

      // Send success message to client
      client.emit('auth_success', {
        message: 'Authentication successful',
        userId: userId,
      });
    } catch (error) {
      console.error('Authentication failed:', error.message);
      // client.emit('error', {
      //   message: error.message,
      // });
      client.emit('error', {
        type: 'unauthorized',
        message: error.message,
      });

      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    // 清理连接记录
    this.connections.forEach((sockets, userId) => {
      if (sockets.has(client.id)) {
        sockets.delete(client.id);
        Logger.log(`Client disconnected: ${client.id} from user ${userId}`);
        Logger.log(`Remaining connections for user ${userId}: ${sockets.size}`);
      }
    });
  }

  sendProgress(
    userId: number,
    taskId: string,
    progress: number,
    status: string,
  ) {
    console.log('sendProgress', userId, taskId, progress, status);
    this.server.to(`user-${userId}`).emit(`task-${taskId}-pending`, {
      progress: progress || 0,
      message: status || '',
      taskId,
    });
  }

  sendTaskInit(userId: number, taskId: string) {
    console.log('sendTaskInit', userId, taskId);
    // 发送初始化任务
    this.server.to(`user-${userId}`).emit(`task-init`, {
      taskId,
    });
  }

  async clearUserConnections(userId: number) {
    try {
      const userRoom = `user-${userId}`;
      const room = this.server.sockets.adapter.rooms.get(userRoom);

      if (room) {
        // Get all socket IDs in the user's room
        const socketIds = Array.from(room);

        // Disconnect each socket in the room
        for (const socketId of socketIds) {
          const socket = this.server.sockets.sockets.get(socketId);
          if (socket) {
            socket.disconnect(true);
          }
        }

        // Delete the room
        this.server.sockets.adapter.rooms.delete(userRoom);
      }

      Logger.log(`Cleared all connections for user ${userId}`);
    } catch (error) {
      Logger.error(`Error clearing connections for user ${userId}:`, error);
      throw error;
    }
  }

  @SubscribeMessage('message')
  handleMessage(
    @MessageBody() data: { name: string },
    @ConnectedSocket() client: Socket,
  ): void {
    Logger.log(`Received message from client ${client.id}:`, data);

    // 获取用户所在的房间
    const rooms = Array.from(client.rooms);
    const userRoom = rooms.find((room) => room.startsWith('user-'));

    if (!userRoom) {
      Logger.error('User room not found');
      return;
    }

    // 模拟进度更新
    let progress = 0;
    const interval = setInterval(() => {
      progress += 20;

      // 发送进度信息给房间内的所有客户端
      this.server.to(userRoom).emit('response', {
        name: data.name,
        progress: progress,
        message: progress === 100 ? 'Task completed' : 'Processing...',
      });

      // 当进度达到100%时停止
      if (progress >= 100) {
        clearInterval(interval);
      }
    }, 1000); // 每秒更新一次进度
  }
}

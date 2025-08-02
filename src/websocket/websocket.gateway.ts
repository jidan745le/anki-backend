import { Inject, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: false,
  pingTimeout: 15000,
  pingInterval: 5000,
})
export class WebsocketGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(WebsocketGateway.name);
  constructor() {
    Logger.log('WebsocketGateway constructor');
  }

  @WebSocketServer()
  server: Server;

  @Inject(JwtService)
  private jwtService: JwtService;

  private connections = new Map<string, Set<string>>(); // userId -> Set of socketIds
  private socketToUser = new Map<string, string>(); // socketId -> userId

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
      const userId = payload.user.id.toString();

      client.join(`user-${userId}`);

      // 👆 维护连接映射
      if (!this.connections.has(userId)) {
        this.connections.set(userId, new Set());
      }
      this.connections.get(userId)!.add(client.id);
      this.socketToUser.set(client.id, userId);

      Logger.log(`Client connected: ${client.id}, userId: ${userId}`);
      //查看当前房间几个connection
      const room = this.server.sockets.adapter.rooms.get(`user-${userId}`);
      Logger.log(`Current connections in room user-${userId}: ${room?.size}`);

      // Send success message to client
      client.emit('auth_success', {
        message: 'Authentication successful',
        userId: userId,
        socketId: client.id, // 👆 返回socketId给客户端
      });
    } catch (error) {
      console.error('Authentication failed:', error.message);
      client.emit('error', {
        type: 'unauthorized',
        message: error.message,
      });

      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    // 清理连接记录
    const userId = this.socketToUser.get(client.id);
    if (userId) {
      const userSockets = this.connections.get(userId);
      if (userSockets) {
        userSockets.delete(client.id);
        Logger.log(`Client disconnected: ${client.id} from user ${userId}`);
        Logger.log(
          `Remaining connections for user ${userId}: ${userSockets.size}`,
        );

        // 如果该用户没有任何连接了，删除整个记录
        if (userSockets.size === 0) {
          this.connections.delete(userId);
        }
      }
      this.socketToUser.delete(client.id);
    }
  }

  // 👆 新增：向特定连接发送消息
  sendToConnection(socketId: string, event: string, data: any) {
    const socket = this.server.sockets.sockets.get(socketId);
    if (socket) {
      socket.emit(event, data);
      Logger.log(`Message sent to connection ${socketId}: ${event}`);
      return true;
    } else {
      Logger.warn(`Connection ${socketId} not found`);
      return false;
    }
  }

  // 👆 新增：向特定连接发送进度消息
  sendProgressToConnection(
    socketId: string,
    taskId: string,
    progress: number,
    status: string,
  ) {
    console.log('sendProgressToConnection', socketId, taskId, progress, status);
    return this.sendToConnection(socketId, `task-${taskId}-pending`, {
      progress: progress || 0,
      message: status || '',
      taskId,
    });
  }

  // 👆 新增：向特定连接发送任务初始化
  sendTaskInitToConnection(socketId: string, taskId: string) {
    console.log('sendTaskInitToConnection', socketId, taskId);
    return this.sendToConnection(socketId, 'task-init', {
      taskId,
    });
  }

  // 👆 新增：获取用户的所有连接ID
  getUserConnections(userId: number): string[] {
    const connections = this.connections.get(userId.toString());
    return connections ? Array.from(connections) : [];
  }

  // 👆 新增：检查连接是否存在
  isConnectionActive(socketId: string): boolean {
    return this.server.sockets.sockets.has(socketId);
  }

  // 👆 现有方法：向用户所有连接发送消息（保持向后兼容）
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

  // 👆 新增：向特定用户的特定连接发送消息
  sendToUser(
    userId: number,
    socketId: string,
    event: string,
    data: any,
    isBinary = false,
  ) {
    const userIdStr = userId.toString();
    const userConnections = this.connections.get(userIdStr);
    this.logger.log(
      'sendToUser',
      userId,
      socketId,
      userIdStr,
      JSON.stringify(Object.entries(userConnections || {})),
      userConnections?.has(socketId),
    );

    // 检查该socketId是否属于该用户
    if (!userConnections || !userConnections.has(socketId)) {
      Logger.warn(`Socket ${socketId} not found for user ${userId}`);
      return false;
    }

    const socket = this.server.sockets.sockets.get(socketId);
    if (!socket) {
      Logger.warn(`Socket ${socketId} not found in server`);
      return false;
    }

    try {
      if (isBinary) {
        // 发送二进制数据
        socket.emit(event, data);
      } else {
        // 发送普通事件数据
        socket.emit(event, data);
      }
      Logger.log(
        `Message sent to user ${userId} connection ${socketId}: ${event}`,
      );
      return true;
    } catch (error) {
      Logger.error(
        `Failed to send message to user ${userId} connection ${socketId}:`,
        error,
      );
      return false;
    }
  }
}

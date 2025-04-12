// websocket.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { EventEmitter } from 'events';
import { Socket, io } from 'socket.io-client'; // 使用 socket.io-client
const isDevelopment = process.env.NODE_ENV === 'development';
@Injectable()
export class WebSocketService
  implements OnModuleInit, OnGatewayConnection, OnGatewayDisconnect
{
  constructor() {
    console.log('WebSocketService constructor');
  }
  private client: Socket; // 改为 Socket.IO 的 Socket 类型
  private eventEmitter = new EventEmitter();
  private _isConnected = false;
  private logger = new Logger('WebsocketService');

  onModuleInit() {
    console.log('WebSocketService onModuleInit');
    this.connect();
  }

  private connect() {
    // 使用 Socket.IO 客户端
    this.client = io(
      isDevelopment
        ? 'http://8.222.155.238:8080'
        : 'http://audio-processor:8080',
      {
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        timeout: 20000,
      },
    );

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.client.on('connect', () => {
      console.log('Connected to Python Socket.IO server');
      this._isConnected = true;
      this.eventEmitter.emit('connection', true);
    });

    this.client.on('disconnect', (reason) => {
      console.log(`Disconnected from Python Socket.IO server: ${reason}`);
      this._isConnected = false;
      this.eventEmitter.emit('connection', false);
    });

    this.client.on('message', (data: any) => {
      try {
        // 处理消息
        if (data.type) {
          this.eventEmitter.emit(data.type, data);
        }
        this.eventEmitter.emit('message', data);
      } catch (error) {
        console.error('Failed to process message:', error);
      }
    });

    this.client.on('connect_error', (error) => {
      console.error('Connection error:', error);
      this.eventEmitter.emit('error', error);
    });
  }

  // 订阅事件的方法
  on(event: string, listener: (...args: any[]) => void) {
    this.eventEmitter.on(event, listener);
    return () => this.eventEmitter.off(event, listener);
  }

  // 一次性订阅事件
  once(event: string, listener: (...args: any[]) => void) {
    this.eventEmitter.once(event, listener);
  }

  // 发送消息
  async send(type: string, data?: any): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this._isConnected) {
        console.log('Socket.IO is not connected');
        resolve(false);
        return;
      }

      try {
        this.client.emit('message', { type, data });
        resolve(true);
      } catch (error) {
        console.error('Failed to send message:', error);
        resolve(false);
      }
    });
  }

  // 检查连接状态
  isConnected(): boolean {
    return this._isConnected;
  }

  // 手动重连
  reconnect() {
    if (!this._isConnected) {
      this.client.connect();
    }
  }

  // 手动关闭连接
  disconnect() {
    if (this.client) {
      this.client.disconnect();
    }
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }
}

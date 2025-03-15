import { Global, Module } from '@nestjs/common';
import { WebsocketGateway } from './websocket.gateway';
import { WebSocketService } from './websocket.socket';

@Global()
@Module({
  providers: [WebsocketGateway, WebSocketService],
  exports: [WebsocketGateway, WebSocketService],
})
export class WebsocketModule {}

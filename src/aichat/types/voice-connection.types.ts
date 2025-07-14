import * as WebSocket from 'ws';
import { CharacterType } from '../dto/create-chat-message.dto';

export enum VoiceConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
}

export enum VoiceTaskState {
  IDLE = 'idle', // 连接空闲，可以接受新任务
  CONNECTION_INIT = 'connection-init', // 与cosyvoice socket刚刚建立
  PENDING_TASK = 'pending-task', // 已发送run-task，待接收task-started
  TASK_STARTED = 'task-started', // 应用收到cosyvoice的task-started
  MESSAGE_SENT_FINISHED = 'message-sent-finished', // 文本流发送完，发送finish-task到cosyvoice
  TASK_FINISHED = 'task-finished', // 该任务语音数据流已推完
  TASK_FAILED = 'task-failed', // 任务失败
  TASK_INTERRUPTED = 'task-interrupted', // 任务被用户中断
  CONNECTION_CLOSE = 'connection-close', // 与cosyvoice socket关闭
}

export interface UserVoiceConnection {
  userId: number;
  socketId: string;
  character: CharacterType;
  connectionState: VoiceConnectionState;
  taskState: VoiceTaskState;
  websocket: WebSocket | null;
  currentTaskId: string | null;
  currentSessionId: string | null;
  speechRate: number;
  lastActivity: Date;
  emotionProcessed: boolean;
  audioStarted: boolean;
  previousAudioLength: number;
}

export interface VoiceMessage {
  header: {
    action: string;
    task_id: string;
    streaming?: string;
    event?: string;
    error_message?: string;
  };
  payload: {
    task_group?: string;
    task?: string;
    function?: string;
    model?: string;
    parameters?: {
      text_type?: string;
      voice?: string;
      format?: string;
      sample_rate?: number;
      volume?: number;
      rate?: number;
      pitch?: number;
      enable_ssml?: boolean;
    };
    input?: {
      text?: string;
    };
  };
}

export interface CharacterConfig {
  name: string;
  voiceId: string;
  systemPrompt: string;
  emotionPatterns: string[];
}

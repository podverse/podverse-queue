import amqp, { ChannelModel, ConfirmChannel } from "amqplib";
import { RabbitMQRequestService } from '@queue/services/rabbitmq/requestService';
import { LoggerService } from 'podverse-helpers/dist/lib/backend/logger';

export type AMQPMessage = amqp.Message;
export type QueueName = 'rss-slow' | 'rss-fast' | 'rss-live';
export const queueNames: QueueName[] = ['rss-slow', 'rss-fast', 'rss-live'];

type QueueRSSMessage = {
  url: string;
  podcast_index_id: number | null;
}

type Message = QueueRSSMessage;

export interface RabbitMQServiceParams {
  protocol: string;
  host: string;
  username: string;
  password: string;
  port: number;
  vhost: string;
}

export class RabbitMQService {
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private rabbitMQRequest: RabbitMQRequestService;
  private logger: LoggerService;

  constructor(
    params: RabbitMQServiceParams,
    logger: LoggerService
  ) {
    this.rabbitMQRequest = new RabbitMQRequestService(params);
    this.connectionUri = `amqp://${params.username}:${params.password}@${params.host}:${params.port}${params.vhost}`;
    this.logger = logger;
  }

  private connectionUri: string;

  async initialize() {
    try {
      await this.connect();
    } catch (error) {
      this.logger.logError('Failed to initialize RabbitMQ connection', error as Error);
    }
  }

  private async connect() {
    try {
      this.connection = await amqp.connect(this.connectionUri);
      this.connection.on('error', (error: unknown) => {
        this.logger.logError('connect: RabbitMQ connection error', error as Error);
        this.reconnect();
      });
      this.connection.on('close', () => {
        this.logger.info('RabbitMQ connection closed');
        this.reconnect();
      });
      this.channel = await this.connection.createConfirmChannel();
      await this.createQueues();
    } catch (error) {
      this.logger.logError('connect: Failed to connect to RabbitMQ', error as Error);
      setTimeout(() => this.connect(), 5000); // Retry connection after 5 seconds
    }
  }

  private async reconnect() {
    if (this.connection) {
      try {
        await this.connection.close();
      } catch (error) {
        this.logger.logError('reconnect: Error closing RabbitMQ connection during reconnect', error as Error);
      }
    }
    this.connection = null;
    this.channel = null;
    setTimeout(() => this.connect(), 5000); // Retry connection after 5 seconds
  }

  async createQueues() {
    for (const queueName of queueNames) {
      try {
        await this.assertQueue(queueName);
      } catch (error) {
        throw new Error(`createQueues: Failed to create queue ${queueName} ${error}`);
      }
    }
  }

  async assertQueue(queueName: QueueName) {
    if (this.channel) {
      await this.channel.assertQueue(queueName, {
        durable: true,
      });
      this.logger.info(`Queue ${queueName} is ready`);
    } else {
      this.logger.logError('assertQueue: Channel is not initialized');
    }
  }
 
  async sendMessage(queueName: QueueName, message: Message): Promise<void> {
    if (this.channel) {
      try {
        const messageString = JSON.stringify(message);
        const messageBuffer = Buffer.from(messageString);

        await new Promise<void>((resolve, reject) => {
          this.channel!.sendToQueue(queueName, messageBuffer, { persistent: true }, (error) => {
            if (error) {
              this.logger.logError(`sendMessage: Failed to send message to queue ${queueName}: ${messageString}`, error as Error);
              reject(error);
            } else {
              this.logger.info(`Message sent to queue ${queueName}: ${messageString}`);
              resolve();
            }
          });
        });

      } catch (error) {
        this.logger.logError(`sendMessage: Error sending message to queue ${queueName}`, error as Error);
      }
    } else {
      this.logger.logError('sendMessage: Channel is not initialized');
    }
  }

  async getMessage(queueName: string): Promise<Message | null> {
    if (this.channel) {
      const msg = await this.channel.get(queueName, { noAck: false });
      if (msg) {
        // this.channel.ack(msg);
        const messageString = msg.content.toString();
        const message: Message = JSON.parse(messageString);
        this.logger.info(`Message received from queue ${queueName}: ${messageString}`);
        return message;
      } else {
        this.logger.info(`No messages in queue ${queueName}`);
        return null;
      }
    } else {
      this.logger.logError('getMessage: Channel is not initialized');
      return null;
    }
  }

  async consumeMessages(queueName: QueueName, processMessage: (msg: amqp.Message) => void) {
    if (this.channel) {
      this.channel.prefetch(1);

      const channel = this.channel;

      channel.consume(queueName, async (msg) => {
        if (msg !== null) {
          try {
            const messageContent = msg.content.toString();
            this.logger.info(`Received message from queue ${queueName}: ${messageContent}`);
            await processMessage(msg);
            channel.ack(msg);
          } catch (err) {
            this.logger.logError('Error processing message', err as Error);
            channel?.nack?.(msg, false, false);
          }
        }
      }, { noAck: false });
      this.logger.info(`Consumer is set up for queue ${queueName}`);
    } else {
      this.logger.logError('consumeMessages: Channel is not initialized');
    }
  }
  
  async listAllQueues(): Promise<string[]> {
    try {
      const response: never[] = await this.rabbitMQRequest.request('/queues');
      return response.map((queue: { name: string }) => queue.name);
    } catch (error) {
      this.logger.logError('listAllQueues: Failed to list queues', error as Error);
      return [];
    }
  }

  private async deleteQueue(queueName: string) {
    if (this.channel) {
      try {
        await this.channel.deleteQueue(queueName);
        this.logger.info(`Queue ${queueName} deleted`);
      } catch (error) {
        this.logger.logError(`deleteQueue: Failed to delete queue ${queueName}`, error as Error);
      }
    } else {
      this.logger.logError('deleteQueue: Channel is not initialized');
    }
  }

  async deleteAllQueues() {
    const queues = await this.listAllQueues();
    for (const queue of queues) {
      await this.deleteQueue(queue);
    }
    this.logger.info('All queues deleted');
  }
}

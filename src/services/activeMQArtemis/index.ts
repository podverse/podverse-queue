import rhea from 'rhea';
import { Connection, Sender, Receiver, EventContext, Delivery } from 'rhea';
import { LoggerService } from 'podverse-helpers/dist/lib/backend/logger';
import crypto from 'crypto';

// Public types maintained for backwards compatibility
export type MQQueueName = 'rss-normal' |  'rss-on-demand' | 'rss-live';

type MQRSSMessage = {
  url: string;
  podcast_index_id: number | null;
};

type Message = MQRSSMessage;

type SendMessageParams = {
  queueName: MQQueueName
  message: Message
  priority: 'normal' | 'slow'
  dedupeCacheTimeMS: number | null
}

export interface ActiveMQArtemisServiceParams { // Keeping same name for external compatibility
  protocol: string;
  host: string;
  username: string;
  password: string;
  port: number;
}

export class ActiveMQArtemisService { // Name preserved
  private connection: Connection | null = null;
  private senders: Map<MQQueueName, Sender> = new Map();
  private receivers: Map<MQQueueName, Receiver> = new Map();
  private params: ActiveMQArtemisServiceParams;
  private logger: LoggerService;
  private connecting = false;

  constructor(params: ActiveMQArtemisServiceParams, logger: LoggerService) {
    this.params = params;
    this.logger = logger;
  }

  async initialize() {
    // Queues are assumed to be pre-created externally (e.g. via provisioning script or broker config).
    try {
      await this.connect();
    } catch (error) {
      this.logger.logError('Failed to initialize Artemis connection', error as Error);
    }
  }

  private async connect() {
    if (this.connection || this.connecting) return;
    this.connecting = true;
    return new Promise<void>((resolve, reject) => {
      // Debug info about imported rhea module
      try {
        interface RheaConnectOptions {
          host: string;
          port: number;
          username?: string;
          password?: string;
          reconnect?: boolean;
          reconnect_limit?: number;
          [k: string]: unknown;
        }
        interface RheaLike { connect?: (options: RheaConnectOptions) => Connection; [k: string]: unknown }
        const rheaLike: RheaLike = (rhea as unknown as RheaLike);
        // Log a minimal snapshot of the rhea import for troubleshooting
        if (typeof rheaLike.connect !== 'function') {
          const err = new TypeError('rhea.connect is not a function – possible ESM/CJS import mismatch');
          this.logger.logError('Artemis connect failed early', err);
          this.connecting = false; // allow retry attempts later
          return reject(err);
        }
        const connection = rheaLike.connect!({
          host: this.params.host,
          port: this.params.port,
          username: this.params.username,
          password: this.params.password,
          reconnect: true,
          reconnect_limit: -1
        }) as Connection;

        connection.on('connection_open', () => {
          this.logger.info('Artemis AMQP connection established');
          this.connection = connection;
          this.connecting = false;
          resolve();
        });

        connection.on('connection_error', (context: EventContext) => {
          this.logger.logError('Artemis connection error', context.error as Error);
        });

        connection.on('disconnected', () => {
          this.logger.info('Artemis connection disconnected – will attempt reconnect');
          this.connection = null;
        });
      } catch (err) {
        this.logger.logError('Artemis connect threw synchronously', err as Error);
        this.connecting = false; // reset so future retries can occur
        reject(err as Error);
      }
    });
  }

  private async ensureSender(queueName: MQQueueName): Promise<Sender> {
    if (this.senders.has(queueName)) return this.senders.get(queueName)!;
    if (!this.connection) await this.connect();
    const sender = this.connection!.open_sender({ target: { address: queueName } });
    return new Promise((resolve) => {
      sender.on('sender_open', () => {
        this.logger.info(`Sender ready for queue ${queueName}`);
        this.senders.set(queueName, sender);
        resolve(sender);
      });
    });
  }

  private async ensureReceiver(queueName: MQQueueName): Promise<Receiver> {
    if (this.receivers.has(queueName)) return this.receivers.get(queueName)!;
    if (!this.connection) await this.connect();
    const receiver = this.connection!.open_receiver({ source: { address: queueName }, credit_window: 10 });
    return new Promise((resolve) => {
      receiver.on('receiver_open', () => {
        this.logger.info(`Receiver ready for queue ${queueName}`);
        this.receivers.set(queueName, receiver);
        resolve(receiver);
      });
    });
  }

  private computeDuplicateId(queueName: MQQueueName, message: Message, dedupeCacheTimeMS: number | null): string | null {
    if (!dedupeCacheTimeMS || dedupeCacheTimeMS <= 0) return null;
    const baseHash = crypto.createHash('sha256').update(JSON.stringify(message)).digest('hex');
    const now = Date.now();
    const bucketStart = Math.floor(now / dedupeCacheTimeMS) * dedupeCacheTimeMS;
    return `${queueName}:${bucketStart}:${baseHash}`;
  }

  async sendMessage(params: SendMessageParams): Promise<void> {
    const { queueName, message, priority, dedupeCacheTimeMS } = params;
    try {
      const sender = await this.ensureSender(queueName);
      const bodyString = JSON.stringify(message);
      const duplicateId = this.computeDuplicateId(queueName, message, dedupeCacheTimeMS);
      const priorityValue = !priority || priority === 'normal' ? 5 : 1;
      await new Promise<void>((resolve, reject) => {
        const delivery = sender.send({
          body: bodyString,
          durable: true,
          priority: priorityValue,
          content_type: 'application/json',
          ...(duplicateId
            ? { application_properties: { _AMQ_DUPL_ID: duplicateId } }
            : {}) // omit property when no dedupe
        });
        const onAccepted = (context: EventContext) => {
          if (context.delivery === delivery) {
            this.logger.info(`Message sent to queue ${queueName}: ${bodyString}`);
            sender.removeListener('accepted', onAccepted);
            sender.removeListener('rejected', onRejected);
            resolve();
          }
        };
        const onRejected = (context: EventContext) => {
          if (context.delivery === delivery) {
            this.logger.logError(`sendMessage: Rejected by broker ${queueName}: ${bodyString}`);
            sender.removeListener('accepted', onAccepted);
            sender.removeListener('rejected', onRejected);
            reject(new Error('Message rejected'));
          }
        };
        sender.on('accepted', onAccepted);
        sender.on('rejected', onRejected);
      });
    } catch (error) {
      this.logger.logError(`sendMessage: Error sending message to queue ${queueName}`, error as Error);
    }
  }

  async getMessage(queueName: MQQueueName): Promise<Message | null> {
    try {
      const receiver = await this.ensureReceiver(queueName as MQQueueName);
      // Request one message (credit 1)
      receiver.add_credit(1);
      return await new Promise<Message | null>((resolve) => {
        const onMessage = (context: EventContext) => {
          if (context.receiver === receiver) {
            const body = context.message?.body as string;
            const parsed: Message = JSON.parse(body);
            this.logger.info(`Message received from queue ${queueName}: ${body}`);
            context.delivery?.accept();
            receiver.removeListener('message', onMessage);
            resolve(parsed);
          }
        };
        const onNoMessageTimeout = () => {
          receiver.removeListener('message', onMessage);
          resolve(null);
        };
        receiver.on('message', onMessage);
        // Timeout after 1 second if none
        setTimeout(onNoMessageTimeout, 1000);
      });
    } catch (error) {
      this.logger.logError('getMessage: Error receiving message', error as Error);
      return null;
    }
  }

  async consumeMessages(queueName: MQQueueName, processMessage: (msg: { content: Buffer; raw: Delivery; queue: MQQueueName }) => Promise<void> | void) {
    try {
      const receiver = await this.ensureReceiver(queueName);

      receiver.on('message', async (context: EventContext) => {
        if (context.receiver !== receiver) return;
        try {
          const body = context.message?.body as string;
          this.logger.info(`Received message from queue ${queueName}: ${body}`);
          const delivery = context.delivery!;
          const buffer = Buffer.from(body);
          await processMessage({ content: buffer, raw: delivery, queue: queueName });
          delivery.accept();
        } catch (err) {
          this.logger.logError('Error processing message', err as Error);
          // It's important to still settle the message, otherwise it might be redelivered
          context.delivery?.reject();
        }
      });

      this.logger.info(`Consumer is set up for queue ${queueName}`);
    } catch (error) {
      this.logger.logError('consumeMessages: Failed to set consumer', error as Error);
    }
  }
}

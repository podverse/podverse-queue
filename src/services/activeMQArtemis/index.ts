import rhea from 'rhea';
import { Connection, Sender, Receiver, EventContext } from 'rhea';
import { LoggerService } from 'podverse-helpers/dist/lib/backend/logger';
import crypto from 'crypto';
import { getContainerIpPart } from 'podverse-helpers/dist/lib/backend/os';
import { ParseRSSFeedAndSaveToDatabaseOptions } from 'podverse-parser/dist/lib/rss/parser';

export type MQQueueName =
  | 'rss-normal'
  | 'rss-on-demand'
  | 'rss-live'
  | `DLQ.${'rss-normal' | 'rss-on-demand' | 'rss-live'}`;

type MQRSSMessage = {
  url: string;
  podcast_index_id: number | null;
  options: ParseRSSFeedAndSaveToDatabaseOptions;
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
  private isShuttingDown = false;

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
        const idleTimeOut = 30000;
        const baseId = process.env.CONTAINER_ID
          || process.env.HOSTNAME
          || `podverse-mq-${crypto.randomBytes(4).toString('hex')}`;
        const containerId = `${baseId}${getContainerIpPart()}`;

        const connection = rheaLike.connect!({
          host: this.params.host,
          port: this.params.port,
          username: this.params.username,
          password: this.params.password,
          // send AMQP heartbeats so broker (default 60s TTL) sees activity and stays alive until manually closed
          idle_time_out: idleTimeOut,
          container_id: containerId,
          properties: { product: 'podverse-mq' },
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
    const receiver = this.connection!.open_receiver({ source: { address: queueName }, credit_window: 0 });
    return new Promise((resolve) => {
      receiver.on('receiver_open', () => {
        this.logger.info(`Receiver ready for queue ${queueName}`);
        this.receivers.set(queueName, receiver);
        receiver.add_credit(1);
        resolve(receiver);
      });
    });
  }

  private computeDuplicateId(queueName: MQQueueName, message: Message, dedupeCacheTimeMS: number | null): string | null {
    if (!dedupeCacheTimeMS || dedupeCacheTimeMS <= 0) return null;
    const baseHash = crypto.createHash('sha256').update(JSON.stringify(message.podcast_index_id)).digest('hex');
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

  /**
   * Send a sample message directly to the Dead Letter Address for the given queue.
   * Useful for debugging DLQ consumers without needing to trigger failures.
   * The DLQ queues are bound to addresses of the form `DLQ.<queueName>`.
   */
  async sendSampleToDLQ(
    queueName: MQQueueName,
    sample: Record<string, unknown>,
    failureDescription = 'Sample DLQ message for debugging'
  ): Promise<void> {
    try {
      if (!this.connection) await this.connect();

      // Choose target based on what exists in your broker
      const dlqTargets: MQQueueName[] = [`DLQ.${queueName}` as MQQueueName];

      for (const dlqQueue of dlqTargets) {
        const sender = this.connection!.open_sender({ target: { address: dlqQueue } });
        await new Promise<void>((resolve) => sender.once('sender_open', () => resolve()));

        const payload = { ...sample };
        const bodyString = JSON.stringify(payload);
        const delivery = sender.send({
          body: bodyString,
          durable: true,
          content_type: 'application/json',
          application_properties: {
            _AMQ_DLQ_DELIVERY_FAILURE_CAUSE: failureDescription,
            'x-opt-delivery-failure-cause': failureDescription
          }
        });

        await new Promise<void>((resolve, reject) => {
          const onAccepted = (context: EventContext) => {
            if (context.delivery === delivery) {
              this.logger.info(`DLQ sample sent to ${dlqQueue}`);
              cleanup();
              resolve();
            }
          };
          const onRejected = (context: EventContext) => {
            if (context.delivery === delivery) {
              const err = new Error(`DLQ sample send was rejected for ${dlqQueue}`);
              this.logger.logError('sendSampleToDLQ: rejected', err);
              cleanup();
              reject(err);
            }
          };
          const cleanup = () => {
            sender.removeListener('accepted', onAccepted);
            sender.removeListener('rejected', onRejected);
          };
          sender.on('accepted', onAccepted);
          sender.on('rejected', onRejected);
        });
      }
    } catch (error) {
      this.logger.logError('sendSampleToDLQ: Error sending sample to DLQ', error as Error);
    }
  }

  async consumeMessages(queueName: MQQueueName, processMessage: (context: EventContext) => Promise<void> | void) {
    try {
      const receiver = await this.ensureReceiver(queueName);

      receiver.on('message', async (context: EventContext) => {
        if (context.receiver !== receiver) return;
        try {
          // The processing function is now responsible for accepting/rejecting.
          await processMessage(context);
        } catch (err) {
          const error = err as Error;
          this.logger.logError('Error processing message', error);
          // If the processor throws, reject the message as a fallback.
          context.delivery?.reject({
            condition: 'podverse:processing-error',
            description: error.message
          });
        } finally {
          receiver.add_credit(1);
        }
      });

      this.logger.info(`Consumer is set up for queue ${queueName}`);
    } catch (error) {
      this.logger.logError('consumeMessages: Failed to set consumer', error as Error);
    }
  }

  getIsShuttingDown(): boolean {
    return this.isShuttingDown;
  }

  async close(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    this.logger.info('Closing ActiveMQ Artemis connection...');
    const closeTimeoutMs = 10000;

    const doClose = async () => {
    
      // Close all receivers first to stop accepting new messages
      for (const [queueName, receiver] of this.receivers.entries()) {
        try {
          receiver.close();
          this.logger.info(`Closed receiver for queue ${queueName}`);
        } catch (error) {
          this.logger.logError(`Error closing receiver for ${queueName}`, error as Error);
        }
      }
      this.receivers.clear();

      // Close all senders
      for (const [queueName, sender] of this.senders.entries()) {
        try {
          sender.close();
          this.logger.info(`Closed sender for queue ${queueName}`);
        } catch (error) {
          this.logger.logError(`Error closing sender for ${queueName}`, error as Error);
        }
      }
      this.senders.clear();

      // Close the connection
      if (this.connection) {
        try {
          // Prevent reconnect attempts while we're shutting down
          try {
            // Attempt to disable reconnect behavior before closing.
            // rhea doesn't provide a documented toggle here, so remove event listeners
            // and try to flip common internal flags if present to avoid immediate reconnects.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const connAny = this.connection as unknown as Record<string, any>;
            if (connAny) {
              if (typeof connAny.removeAllListeners === 'function') {
                connAny.removeAllListeners();
              }
              // some rhea versions expose internal options or flags we can defensively set
              if (connAny.options && typeof connAny.options.reconnect !== 'undefined') {
                try { connAny.options.reconnect = false; } catch {
                  // swallow
                }
              }
              try { connAny.reconnect = false; } catch {
                // swallow
              }
            }
          } catch {
            // swallow - this is best-effort cleanup prior to close
          }

          this.connection.close();
          this.logger.info('Closed ActiveMQ Artemis connection');
        } catch (error) {
          this.logger.logError('Error closing connection', error as Error);
        }
        this.connection = null;
      }
    };

    // race close against a timeout to avoid hanging shutdown; create timer before starting close
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        this.logger.error(`ActiveMQ Artemis close() timed out after ${closeTimeoutMs}ms`);
        resolve();
      }, closeTimeoutMs);
    });

    try {
      await Promise.race([doClose(), timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

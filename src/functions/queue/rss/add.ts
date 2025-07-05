import { QueueName, RabbitMQService } from "@queue/services/rabbitmq";

type QueueRSSAddOptions = {
  queueName: QueueName;
  feedUrl: string;
  podcastIndexId: number;
}

export const queueRSSAdd = async (options: QueueRSSAddOptions) => {
  const rabbitMQService = new RabbitMQService();
  await rabbitMQService.initialize();

  const message = {
    url: options.feedUrl,
    podcast_index_id: options.podcastIndexId
  };

  await rabbitMQService.sendMessage(options.queueName, message);
};

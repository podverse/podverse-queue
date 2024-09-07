import { logger } from "podverse-helpers";
import { parseRSSFeedAndSaveToDatabase } from "podverse-parser";
import { QueueName, RabbitMQService } from "@queue/services/rabbitmq";

export const queueRSSRunParser = async (queueName: QueueName) => {
  const rabbitMQService = new RabbitMQService();
  await rabbitMQService.initialize();

  await rabbitMQService.consumeMessages(queueName, async (message) => {
    try {
      const receivedMessageString = message.content.toString();
      const receivedMessage = JSON.parse(receivedMessageString);
      const { url, podcast_index_id } = receivedMessage;
      await parseRSSFeedAndSaveToDatabase(url, podcast_index_id);
    } catch (error) {
      logger.error('Error processing message', error);
    }
  });
};

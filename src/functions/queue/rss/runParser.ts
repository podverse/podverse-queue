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
      logger.info(`url ${url}`);
      logger.info(`podcast_index_id ${podcast_index_id}`);
      if (url || podcast_index_id) {
        await parseRSSFeedAndSaveToDatabase(url, podcast_index_id);
      } else {
        logger.error('queueRSSRunParser: url or podcast_index_id not found in message', receivedMessage);
      }
    } catch (error) {
      logger.error('Error processing message', error);
    }
  });
};
